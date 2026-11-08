const MEAL_API = "https://www.themealdb.com/api/json/v1/1";
const PRODUCT_API = "https://world.openfoodfacts.org";
const GOALS = {
  calories: 2000,
  protein: 50,
  carbs: 250,
  fat: 65,
};
const PRODUCT_CATEGORIES = [
  "Breakfast Cereals",
  "Beverages",
  "Snacks",
  "Dairy Products",
  "Fruits",
  "Vegetables",
  "Breads",
  "Meats",
  "Frozen Foods",
  "Sauces & Condiments",
];

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHTML = (value = "") => {
  const characters = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value).replace(/[&<>"']/g, (character) => characters[character]);
};

const number = (value, fallback = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

class ApiService {
  async request(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }
  async getCategories() {
    const data = await this.request(`${MEAL_API}/categories.php`);
    return data.categories || [];
  }

  async getAreas() {
    const data = await this.request(`${MEAL_API}/list.php?a=list`);
    return data.meals || [];
  }

  async getMealsByCategory(category) {
    const url = `${MEAL_API}/filter.php?c=${encodeURIComponent(category)}`;
    const data = await this.request(url);
    return data.meals || [];
  }

  async getMealsByArea(area) {
    const url = `${MEAL_API}/filter.php?a=${encodeURIComponent(area)}`;
    const data = await this.request(url);
    return data.meals || [];
  }

  async getMeal(id) {
    const url = `${MEAL_API}/lookup.php?i=${encodeURIComponent(id)}`;
    const data = await this.request(url);
    return data.meals?.[0] || null;
  }

  async searchMeals(query) {
    const url = `${MEAL_API}/search.php?s=${encodeURIComponent(query)}`;
    const data = await this.request(url);
    return data.meals || [];
  }

  async searchProducts(query, page = 1) {
    const fields = "code,product_name,brands,image_front_url,image_url,nutriscore_grade,nutriments,quantity";
    const url = `${PRODUCT_API}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=24&page=${page}&fields=${fields}`;
    const data = await this.request(url);
    return data.products || [];
  }
  async getProduct(barcode) {
    const data = await this.request(`${PRODUCT_API}/api/v2/product/${encodeURIComponent(barcode)}.json`);
    return data.status === 1 ? data.product : null;
  }
}

class FoodLog {
  constructor() {
    this.storageKey = "nutriplan-foodlog-v1";
    this.read();
  }

  read() {
    try {
      const savedDays = localStorage.getItem(this.storageKey) || "{}";
      this.days = JSON.parse(savedDays);
    } catch {
      this.days = {};
    }
  }

  dateKey(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  today() {
    return this.days[this.dateKey()] || [];
  }

  add(item) {
    const key = this.dateKey();
    this.days[key] ||= [];
    const savedItem = {
      ...item,
      logId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      loggedAt: new Date().toISOString(),
    };

    this.days[key].push(savedItem);
    this.save();
  }

  remove(logId) {
    const key = this.dateKey();
    this.days[key] = this.today().filter((item) => item.logId !== logId);
    this.save();
  }

  clearToday() {
    delete this.days[this.dateKey()];
    this.save();
  }

  forDate(date) {
    return this.days[this.dateKey(date)] || [];
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.days));
  }

  totals(items = this.today()) {
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    };

    items.forEach((item) => {
      Object.keys(totals).forEach((key) => {
        totals[key] += number(item[key]);
      });
    });

    return totals;
  }
}

class NutriPlanApp {
  constructor() {
    this.api = new ApiService();
    this.log = new FoodLog();
    this.meals = [];
    this.homeMeals = [];
    this.categories = [];
    this.areas = [];
    this.selectedCategory = "";
    this.selectedArea = "";
    this.selectedMeal = null;
    this.loadingMealId = "";
    this.pendingLog = null;
    this.products = [];
    this.productGrade = "";
    this.productSearchTerm = "";
    this.productCategory = "";
    this.listView = false;
    this.searchTimer = null;
  }

  async init() {
    this.bindEvents();
    this.renderProductCategories();
    this.updateDateLabel();
    this.renderFoodLog();
    await this.loadMealsHome();
    this.route();
    $("#app-loading-overlay")?.classList.add("is-dismissed");
  }

  bindEvents() {
    window.addEventListener("hashchange", () => this.route());
    $$(".nav-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        location.hash = `#${link.dataset.page}`;
        this.closeSidebar();
      });
    });
    $("#meal-categories-section button")?.addEventListener("click", () => {
      this.selectedCategory = "";
      this.selectedArea = "";
      $("#search-input").value = "";
      this.updateActiveFilters();
      this.meals = this.homeMeals;
      this.renderMeals(this.homeMeals);
    });
    $("#search-input")?.addEventListener("input", (event) => {
      clearTimeout(this.searchTimer);
      const query = event.target.value.trim();
      this.searchTimer = setTimeout(() => query ? this.searchMeals(query) : this.refreshMealList(), 280);
    });
    $("#categories-grid")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-category]");
      if (!card) return;
      this.selectedCategory = card.dataset.category === "all" ? "" : card.dataset.category;
      this.selectedArea = "";
      this.refreshMealList();
      this.updateActiveFilters();
    });
    $("#area-filters")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-area]");
      if (!button) return;
      this.selectedArea = button.dataset.area;
      this.selectedCategory = "";
      this.updateActiveFilters();
      if (this.selectedArea) await this.filterByArea(this.selectedArea);
      else {
        this.meals = this.homeMeals;
        this.renderMeals(this.homeMeals);
      }
    });
    $("#recipes-grid")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-meal-id]");
      if (card) this.openMeal(card.dataset.mealId);
    });
    $("#back-to-meals-btn")?.addEventListener("click", () => {
      location.hash = "#meals";
    });
    $("#log-meal-btn")?.addEventListener("click", () => this.openMealLog());
    $("#decrease-servings")?.addEventListener("click", () => this.changeServings(-0.5));
    $("#increase-servings")?.addEventListener("click", () => this.changeServings(0.5));
    $("#meal-servings")?.addEventListener("input", () => this.updateLogPreview());
    $("#cancel-log-meal")?.addEventListener("click", () => this.closeMealLog());
    $("#confirm-log-meal")?.addEventListener("click", () => this.confirmMealLog());
    $("#log-modal-overlay")?.addEventListener("click", (event) => {
      if (event.target.id === "log-modal-overlay") this.closeMealLog();
    });
    $("#grid-view-btn")?.addEventListener("click", () => this.setMealView(false));
    $("#list-view-btn")?.addEventListener("click", () => this.setMealView(true));
    $("#header-menu-btn")?.addEventListener("click", () => this.toggleSidebar());
    $("#sidebar-close-btn")?.addEventListener("click", () => this.closeSidebar());
    $("#sidebar-overlay")?.addEventListener("click", () => this.closeSidebar());
    $("#search-product-btn")?.addEventListener("click", () => this.searchProducts($("#product-search-input").value));
    $("#product-search-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.searchProducts(event.currentTarget.value);
    });
    $("#lookup-barcode-btn")?.addEventListener("click", () => this.lookupBarcode($("#barcode-input").value));
    $("#barcode-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.lookupBarcode(event.currentTarget.value);
    });
    $("#products-grid")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-product]");
      if (button) this.addProductToLog(button.dataset.addProduct);
    });
    $$(".nutri-score-filter").forEach((button) => button.addEventListener("click", () => {
      this.productGrade = button.dataset.grade;
      this.filterProducts();
      $$(".nutri-score-filter").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.style.backgroundColor = active ? "#059669" : "";
        item.style.color = active ? "#fff" : "";
      });
    }));
    $("#product-categories")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-product-category]");
      if (button) {
        this.productCategory = button.dataset.productCategory;
        this.searchProducts(this.productCategory);
      }
    });
    $("#close-product-modal")?.addEventListener("click", () => this.closeProductModal());
    $("#product-modal")?.addEventListener("click", (event) => {
      if (event.target.id === "product-modal") this.closeProductModal();
    });
    $("#clear-foodlog")?.addEventListener("click", () => {
      const hasItems = this.log.today().length > 0;
      if (hasItems && window.confirm("Clear all foods logged today?")) {
        this.log.clearToday();
        this.renderFoodLog();
      }
    });
    $("#logged-items-list")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-log]");
      if (button) {
        this.log.remove(button.dataset.removeLog);
        this.renderFoodLog();
      }
    });
    $$(".quick-log-btn").forEach((button, index) => {
      button.addEventListener("click", () => {
        if (index === 0) location.hash = "#meals";
        else if (index === 1) location.hash = "#products";
        else this.customEntry();
      });
    });
    $(".browse-recipes-btn")?.addEventListener("click", () => {
      location.hash = "#meals";
    });
    $(".scan-product-btn")?.addEventListener("click", () => {
      location.hash = "#products";
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeMealLog();
        this.closeProductModal();
        this.closeSidebar();
      }
    });
  }

  async loadMealsHome() {
    const grid = $("#recipes-grid");
    this.setMessage(grid, "Loading recipes…");
    try {
      [this.categories, this.areas] = await Promise.all([this.api.getCategories(), this.api.getAreas()]);
      this.renderCategories();
      this.renderAreas();
      const sample = this.categories.slice(0, 7);
      const groups = await Promise.all(sample.map((category) => this.api.getMealsByCategory(category.strCategory).catch(() => [])));
      const unique = new Map(groups.flat().map((meal) => [meal.idMeal, meal]));
      this.meals = [...unique.values()].slice(0, 25);
      this.homeMeals = this.meals;
      this.renderMeals(this.meals);
    } catch (error) {
      this.setMessage(grid, `Couldn't load recipes. ${escapeHTML(error.message)}. Check your connection and try again.`);
    }
  }

  renderCategories() {
    const grid = $("#categories-grid");
    if (!grid) return;
    grid.innerHTML = this.categories.map((category) => `
      <button class="category-card bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-3 border border-emerald-200 hover:border-emerald-400 hover:shadow-md cursor-pointer transition-all group text-left" data-category="${escapeHTML(category.strCategory)}">
        <span class="flex items-center gap-2.5"><span class="text-white w-9 h-9 bg-gradient-to-br from-emerald-400 to-green-500 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm"><i class="fa-solid fa-utensils"></i></span><span><b class="block text-sm text-gray-900">${escapeHTML(category.strCategory)}</b></span></span>
      </button>`).join("");
  }

  renderAreas() {
    const container = $("#area-filters");
    if (!container) return;
    container.innerHTML = `<button class="area-filter is-active px-4 py-2 rounded-full bg-emerald-600 text-white text-sm whitespace-nowrap" data-area="">All Recipes</button>` + this.areas.map((area) => `<button class="area-filter px-4 py-2 rounded-full bg-gray-100 text-gray-700 text-sm whitespace-nowrap hover:bg-emerald-50" data-area="${escapeHTML(area.strArea)}">${escapeHTML(area.strArea)}</button>`).join("");
  }

  async filterByArea(area) {
    this.setMessage($("#recipes-grid"), `Loading ${escapeHTML(area)} recipes…`);
    try {
      const meals = await this.api.getMealsByArea(area);
      this.meals = meals.slice(0, 25);
      this.renderMeals(this.meals);
    } catch (error) {
      const message = `Couldn't load recipes for ${escapeHTML(area)}. ${escapeHTML(error.message)}`;
      this.setMessage($("#recipes-grid"), message);
    }
  }

  async refreshMealList() {
    const search = $("#search-input")?.value.trim();
    if (search) return this.searchMeals(search);
    if (this.selectedArea) return this.filterByArea(this.selectedArea);
    if (this.selectedCategory) {
      this.setMessage($("#recipes-grid"), `Loading ${escapeHTML(this.selectedCategory)} recipes…`);
      try {
        const meals = await this.api.getMealsByCategory(this.selectedCategory);
        this.meals = meals.slice(0, 25);
        this.renderMeals(this.meals);
      } catch (error) {
        this.setMessage($("#recipes-grid"), `Couldn't load category. ${escapeHTML(error.message)}`);
      }
      return;
    }
    this.meals = this.homeMeals;
    this.renderMeals(this.homeMeals);
  }

  async searchMeals(query) {
    this.setMessage($("#recipes-grid"), "Searching recipes…");
    try {
      const meals = await this.api.searchMeals(query);
      this.meals = meals.slice(0, 25);
      this.renderMeals(this.meals);
    } catch (error) {
      this.setMessage($("#recipes-grid"), `Search failed. ${escapeHTML(error.message)}`);
    }
  }

  renderMeals(meals) {
    const grid = $("#recipes-grid");
    if (!grid) return;
    $("#recipes-count").textContent = `Showing ${meals.length} ${meals.length === 1 ? "recipe" : "recipes"}`;
    if (!meals.length) {
      this.setMessage(grid, "No recipes found. Try another search or filter.");
      return;
    }
    grid.innerHTML = meals.map((meal) => `
      <article class="recipe-card bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer group" role="button" tabindex="0" data-meal-id="${escapeHTML(meal.idMeal)}" aria-label="Open ${escapeHTML(meal.strMeal)}">
        <div class="relative h-48 overflow-hidden"><img class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" src="${escapeHTML(meal.strMealThumb)}" alt="${escapeHTML(meal.strMeal)}" loading="lazy"/><div class="absolute bottom-3 left-3 flex gap-2"><span class="px-2 py-1 bg-white/90 backdrop-blur-sm text-xs font-semibold rounded-full text-gray-700">${escapeHTML(meal.strCategory || this.selectedCategory || "Recipe")}</span>${meal.strArea ? `<span class="px-2 py-1 bg-emerald-500 text-xs font-semibold rounded-full text-white">${escapeHTML(meal.strArea)}</span>` : ""}</div></div>
        <div class="p-4"><h3 class="text-base font-bold text-gray-900 mb-1 group-hover:text-emerald-600 transition-colors line-clamp-1">${escapeHTML(meal.strMeal)}</h3><p class="text-xs text-gray-600 mb-3 line-clamp-2">Delicious recipe to try!</p><div class="flex items-center justify-between text-xs"><span class="font-semibold text-gray-900"><i class="fa-solid fa-utensils text-emerald-600 mr-1"></i>${escapeHTML(meal.strCategory || this.selectedCategory || "Recipe")}</span><span class="font-semibold text-gray-500"><i class="fa-solid fa-globe text-blue-500 mr-1"></i>${escapeHTML(meal.strArea || this.selectedArea || "Explore")}</span></div></div>
      </article>`).join("");
    $$(".recipe-card", grid).forEach((card) => {
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.openMeal(card.dataset.mealId);
        }
      });
    });
  }

  updateActiveFilters() {
    $$(".category-card").forEach((card) => {
      const active = card.dataset.category === this.selectedCategory;
      card.style.borderColor = active ? "#059669" : "";
    });
    $$(".area-filter").forEach((button) => {
      const active = button.dataset.area === this.selectedArea;
      button.classList.toggle("bg-emerald-600", active);
      button.classList.toggle("text-white", active);
      button.classList.toggle("bg-gray-100", !active);
      button.classList.toggle("text-gray-700", !active);
    });
  }

  setMealView(list) {
    this.listView = list;
    const grid = $("#recipes-grid");
    grid?.classList.toggle("recipes-list", list);
    grid?.classList.toggle("grid-cols-4", !list);
    grid?.classList.toggle("grid-cols-1", list);
    $("#grid-view-btn")?.classList.toggle("bg-white", !list);
    $("#list-view-btn")?.classList.toggle("bg-white", list);
  }

  async openMeal(id) {
    if (this.loadingMealId === String(id) || this.selectedMeal?.idMeal === String(id)) {
      this.showPage("meal");
      return;
    }
    this.loadingMealId = String(id);
    location.hash = `#meal/${encodeURIComponent(id)}`;
    this.showPage("meal");
    this.setMessage($("#meal-details"), "Loading recipe details…");
    try {
      const meal = await this.api.getMeal(id);
      if (!meal) throw new Error("Recipe not found");
      this.selectedMeal = meal;
      this.renderMealDetails(meal);
    } catch (error) { this.setMessage($("#meal-details"), `Couldn't load recipe details. ${escapeHTML(error.message)}`); }
    finally { this.loadingMealId = ""; }
  }

  getIngredients(meal) {
    const ingredients = [];

    for (let index = 1; index <= 20; index += 1) {
      const ingredient = meal[`strIngredient${index}`]?.trim();
      const measure = meal[`strMeasure${index}`]?.trim();

      if (ingredient) {
        ingredients.push({ ingredient, measure });
      }
    }

    return ingredients;
  }

  estimateNutrition(meal) {
    const category = `${meal.strCategory || ""} ${meal.strMeal || ""}`.toLowerCase();
    const ingredients = this.getIngredients(meal).map((item) => item.ingredient.toLowerCase()).join(" ");
    const meat = /chicken|beef|lamb|pork|seafood|fish|turkey|duck/.test(`${category} ${ingredients}`);
    const sweet = /dessert|cake|pudding|sweet|chocolate|ice cream/.test(category);
    const starchy = /rice|pasta|potato|bread|noodle|flour|couscous/.test(ingredients);
    const protein = meat ? 28 : /bean|lentil|chickpea|tofu/.test(ingredients) ? 17 : sweet ? 6 : 12;
    const carbs = sweet ? 62 : starchy ? 54 : 30;
    const fat = /cream|cheese|butter|oil|coconut|bacon/.test(ingredients) ? 22 : 13;
    return { calories: Math.round(protein * 4 + carbs * 4 + fat * 9), protein, carbs, fat, fiber: starchy ? 5 : 3, sugar: sweet ? 20 : 6, estimated: true };
  }

  renderMealDetails(meal) {
    const root = $("#meal-details");
    const ingredients = this.getIngredients(meal);
    const steps = (meal.strInstructions || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const nutrition = this.estimateNutrition(meal);
    $("#meal-hero-image").src = meal.strMealThumb;
    $("#meal-hero-image").alt = meal.strMeal;
    $("#meal-title").textContent = meal.strMeal;
    $("#hero-servings").textContent = "1 serving (estimate)";
    $("#hero-calories").textContent = `${nutrition.calories} kcal / serving`;
    $("#log-meal-btn").dataset.mealId = meal.idMeal;
    const ingredientsBox = $("#meal-ingredients");
    ingredientsBox.innerHTML = ingredients.map((item) => `<label class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-emerald-50"><input type="checkbox" class="ingredient-checkbox w-5 h-5 text-emerald-600 rounded"/><span class="text-gray-700"><b class="font-medium text-gray-900">${escapeHTML(item.measure || "")}</b> ${escapeHTML(item.ingredient)}</span></label>`).join("");
    $("#ingredient-count").textContent = `${ingredients.length} items`;
    $("#meal-instructions").innerHTML = steps.map((step, index) => `<div class="flex gap-4 p-4 rounded-xl hover:bg-gray-50"><div class="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">${index + 1}</div><p class="text-gray-700 leading-relaxed pt-2">${escapeHTML(step)}</p></div>`).join("");
    const videoId = this.youtubeId(meal.strYoutube);
    $("#meal-video").src = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : "about:blank";
    this.renderNutrition(nutrition);
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  youtubeId(url = "") { return url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/youtu\.be\/([^?&/]+)/)?.[1] || ""; }

  renderNutrition(nutrition) {
    const container = $("#nutrition-facts-container");
    container.innerHTML = `<p class="text-xs text-gray-500 mb-4">Estimated values per serving · verify with product labels</p><div class="text-center py-4 mb-4 bg-linear-to-br from-emerald-50 to-teal-50 rounded-xl"><p class="text-sm text-gray-600">Calories per serving</p><p class="text-4xl font-bold text-emerald-600">${nutrition.calories}</p><p class="text-xs text-gray-500 mt-1">Recipe API does not include nutrition data</p></div>${[["Protein", nutrition.protein, "emerald"], ["Carbs", nutrition.carbs, "blue"], ["Fat", nutrition.fat, "purple"], ["Fiber", nutrition.fiber, "orange"], ["Sugar", nutrition.sugar, "pink"]].map(([label, amount, color]) => `<div class="mb-3"><div class="flex justify-between text-sm mb-1"><span class="text-gray-700">${label}</span><b>${amount} g</b></div><div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-${color}-500 h-2 rounded-full" style="width:${Math.min(100, amount * 1.6)}%"></div></div></div>`).join("")}`;
  }

  openMealLog() {
    if (!this.selectedMeal) return;
    this.pendingLog = this.estimateNutrition(this.selectedMeal);
    $("#meal-servings").value = "1";
    $("#log-modal-overlay").classList.remove("hidden");
    const img = $("#log-modal-overlay img"); img.src = this.selectedMeal.strMealThumb; img.alt = this.selectedMeal.strMeal;
    $("#log-modal-overlay h3 + p").textContent = this.selectedMeal.strMeal;
    this.updateLogPreview();
  }

  changeServings(delta) {
    const input = $("#meal-servings");
    input.value = Math.max(0.5, number(input.value, 1) + delta);
    this.updateLogPreview();
  }

  updateLogPreview() {
    if (!this.pendingLog) return;
    const servings = Math.max(0.5, number($("#meal-servings").value, 1));
    for (const [key, id] of Object.entries({ calories: "#modal-calories", protein: "#modal-protein", carbs: "#modal-carbs", fat: "#modal-fat" })) $(id).textContent = `${Math.round(this.pendingLog[key] * servings)}${key === "calories" ? "" : "g"}`;
  }

  confirmMealLog() {
    const servings = Math.max(0.5, number($("#meal-servings").value, 1));
    const nutrition = this.pendingLog;
    this.log.add({ type: "meal", name: this.selectedMeal.strMeal, image: this.selectedMeal.strMealThumb, category: this.selectedMeal.strCategory, servings, calories: Math.round(nutrition.calories * servings), protein: nutrition.protein * servings, carbs: nutrition.carbs * servings, fat: nutrition.fat * servings });
    this.closeMealLog(); this.renderFoodLog(); location.hash = "#foodlog";
  }

  closeMealLog() { $("#log-modal-overlay")?.classList.add("hidden"); }

  route() {
    const route = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (!route) history.replaceState(null, "", `${location.pathname}${location.search}#meals`);
    if (route.startsWith("meal/")) { this.showPage("meal"); const id = route.slice(5); if (this.loadingMealId !== id && this.selectedMeal?.idMeal !== id) this.openMeal(id); return; }
    const page = ["products", "foodlog"].includes(route) ? route : "meals";
    this.showPage(page);
  }

  showPage(page) {
    const mealPage = page === "meals";
    $("#search-filters-section").hidden = !mealPage;
    $("#meal-categories-section").hidden = !mealPage;
    $("#all-recipes-section").hidden = !mealPage;
    $("#meal-details").hidden = page !== "meal";
    $("#products-section").hidden = page !== "products";
    $("#foodlog-section").hidden = page !== "foodlog";
    const titles = { meals: ["Meals & Recipes", "Discover delicious and nutritious recipes tailored for you"], meal: ["Meal Details", "Ingredients, cooking steps and nutrition"], products: ["Product Scanner", "Find packaged foods by name or barcode"], foodlog: ["Food Log", "Your daily nutrition at a glance"] };
    $("#header h1").textContent = titles[page][0];
    $("#header p").textContent = titles[page][1];
    $$(".nav-link").forEach((link) => {
      const active = link.dataset.page === (page === "meal" ? "meals" : page);
      link.classList.toggle("bg-emerald-50", active); link.classList.toggle("text-emerald-700", active); link.classList.toggle("font-semibold", active);
    });
    if (page === "foodlog") this.renderFoodLog();
  }

  renderProductCategories() {
    const container = $("#product-categories");
    if (container) container.innerHTML = PRODUCT_CATEGORIES.map((category) => `<button class="product-category-btn px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-emerald-100" data-product-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`).join("");
  }

  async searchProducts(query) {
    query = (query || "").trim();
    if (!query) { this.setMessage($("#products-grid"), "Enter a product name to search."); return; }
    this.productSearchTerm = query;
    this.setMessage($("#products-grid"), "Searching products…");
    $("#products-empty").style.display = "none";
    try {
      this.products = await this.api.searchProducts(query);
      this.filterProducts();
    } catch (error) {
      this.products = [];
      this.setMessage($("#products-grid"), `Product search failed. ${escapeHTML(error.message)}`);
    }
  }

  normalizeProduct(product) {
    const nutrients = product.nutriments || {};
    return {
      code: product.code || "", name: product.product_name || "Unnamed product", brand: product.brands || "", image: product.image_front_url || product.image_url || "", grade: String(product.nutriscore_grade || "?").toLowerCase(), quantity: product.quantity || "100 g serving",
      calories: number(nutrients["energy-kcal_100g"], number(nutrients["energy-kcal_value"], 0)), protein: number(nutrients.proteins_100g), carbs: number(nutrients.carbohydrates_100g), fat: number(nutrients.fat_100g), fiber: number(nutrients.fiber_100g), sugar: number(nutrients.sugars_100g), sodium: number(nutrients.sodium_100g) * 1000
    };
  }

  filterProducts() {
    const filtered = this.products.map((item) => this.normalizeProduct(item)).filter((product) => !this.productGrade || product.grade === this.productGrade);
    $("#products-count").textContent = `${filtered.length} products`;
    $("#products-empty").style.display = filtered.length ? "none" : "block";
    if (!filtered.length) { this.setMessage($("#products-grid"), this.productGrade ? `No products with Nutri-Score ${this.productGrade.toUpperCase()} in these results.` : "No products found. Try another name or barcode."); return; }
    $("#products-grid").innerHTML = filtered.map((product, index) => `
      <article class="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 p-3 flex flex-col">
        <img class="w-full h-40 object-contain bg-gray-50" src="${escapeHTML(product.image || "https://placehold.co/300x200?text=No+image")}" alt="${escapeHTML(product.name)}" loading="lazy"/>
        <div class="pt-3 flex-1"><span class="inline-flex px-2 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700">Nutri-Score ${escapeHTML(product.grade.toUpperCase())}</span><h4 class="font-bold text-gray-900 mt-2 line-clamp-2">${escapeHTML(product.name)}</h4><p class="text-xs text-gray-500 mt-1">${escapeHTML(product.brand || product.quantity)}</p><p class="text-sm text-gray-700 mt-3">${Math.round(product.calories)} kcal · P ${product.protein}g · C ${product.carbs}g · F ${product.fat}g <small class="text-gray-400">/100g</small></p></div>
        <button class="mt-3 w-full px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700" data-add-product="${index}"><i class="fa-solid fa-plus mr-1"></i>Add to Food Log</button>
      </article>`).join("");
    this.visibleProducts = filtered;
  }

  async lookupBarcode(barcode) {
    barcode = (barcode || "").trim();
    if (!barcode) { this.setMessage($("#products-grid"), "Enter a barcode to look up a product."); return; }
    this.setMessage($("#products-grid"), "Looking up barcode…");
    try {
      const product = await this.api.getProduct(barcode);
      if (!product) throw new Error("No product found for this barcode");
      this.products = [product]; this.productGrade = ""; this.filterProducts();
    } catch (error) { this.products = []; this.setMessage($("#products-grid"), escapeHTML(error.message)); }
  }

  addProductToLog(index) {
    const product = this.visibleProducts?.[Number(index)];
    if (!product) return;
    this.log.add({ type: "product", name: product.name, image: product.image, brand: product.brand, barcode: product.code, quantity: product.quantity, servings: 1, calories: product.calories, protein: product.protein, carbs: product.carbs, fat: product.fat });
    this.renderFoodLog();
    location.hash = "#foodlog";
  }

  updateDateLabel() {
    $("#foodlog-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date());
  }

  renderFoodLog() {
    if (!$("#foodlog-section")) return;
    const items = this.log.today();
    const totals = this.log.totals(items);
    const metricCards = $$("#foodlog-today-section .grid > div");
    const keys = ["calories", "protein", "carbs", "fat"];
    metricCards.slice(0, 4).forEach((card, index) => {
      const key = keys[index]; const goal = GOALS[key]; const current = totals[key];
      const value = card.querySelector(".flex span:last-child");
      if (value) value.textContent = `${Math.round(current)} / ${goal} ${key === "calories" ? "kcal" : "g"}`;
      const bar = card.querySelector(".w-full > div");
      if (bar) bar.style.width = `${Math.min(100, current / goal * 100)}%`;
      if (key === "calories" && current > goal) card.classList.add("ring-2", "ring-red-400"); else card.classList.remove("ring-2", "ring-red-400");
    });
    const heading = $("#logged-items-list")?.parentElement?.querySelector("h4");
    if (heading) heading.textContent = `Logged Items (${items.length})`;
    $("#clear-foodlog").style.display = items.length ? "" : "none";
    const list = $("#logged-items-list");
    list.innerHTML = items.length ? items.map((item) => `<article class="flex items-center justify-between gap-4 bg-gray-50 rounded-xl p-3"><div class="flex items-center gap-3 min-w-0">${item.image ? `<img class="w-12 h-12 rounded-lg object-cover" src="${escapeHTML(item.image)}" alt=""/>` : `<span class="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center"><i class="fa-solid fa-bowl-food"></i></span>`}<div class="min-w-0"><b class="block truncate">${escapeHTML(item.name)}</b><small class="text-gray-500">${item.type === "product" ? "Product" : `Meal · ${escapeHTML(item.category || "Recipe")}`} · ${Math.round(item.calories)} kcal · P ${Math.round(item.protein)}g · C ${Math.round(item.carbs)}g · F ${Math.round(item.fat)}g</small></div></div><button class="text-red-500 hover:text-red-700 px-3 py-2" aria-label="Remove ${escapeHTML(item.name)}" data-remove-log="${escapeHTML(item.logId)}"><i class="fa-solid fa-trash"></i></button></article>`).join("") : `<div class="text-center py-8 text-gray-500"><i class="fa-solid fa-utensils text-4xl mb-3 text-gray-300"></i><p class="font-medium">No foods logged today</p><p class="text-sm">Add recipes or scanned products to see your daily totals.</p></div>`;
    this.renderWeeklyOverview();
  }

  renderWeeklyOverview() {
    const container = $("#weekly-days-container");
    if (!container) return;
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today); date.setDate(today.getDate() - (6 - offset));
      const totals = this.log.totals(this.log.forDate(date));
      return { date, totals };
    });
    container.innerHTML = days.map(({ date, totals }) => `<div class="rounded-xl bg-gray-50 p-3 text-center"><p class="text-xs text-gray-500">${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</p><p class="font-bold text-sm mt-1">${Math.round(totals.calories)}</p><div class="h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden"><div class="bg-emerald-500 h-full rounded-full" style="width:${Math.min(100, totals.calories / GOALS.calories * 100)}%"></div></div></div>`).join("");
  }

  customEntry() {
    const name = window.prompt("Food name:");
    if (!name?.trim()) return;
    const calories = number(window.prompt("Calories?", "0"));
    const protein = number(window.prompt("Protein in grams?", "0"));
    const carbs = number(window.prompt("Carbohydrates in grams?", "0"));
    const fat = number(window.prompt("Fat in grams?", "0"));
    this.log.add({ type: "custom", name: name.trim(), servings: 1, calories, protein, carbs, fat });
    this.renderFoodLog(); location.hash = "#foodlog";
  }

  setMessage(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="col-span-full py-12 text-center text-gray-500">${message}</div>`;
  }

  toggleSidebar() {
    $("#sidebar").classList.toggle("open");
    $("#sidebar-overlay").classList.toggle("active");
  }
  closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebar-overlay")?.classList.remove("active");
  }
  closeProductModal() {
    $("#product-modal")?.classList.add("hidden");
    document.body.classList.remove("product-modal-open");
  }
}

const app = new NutriPlanApp();
app.init();
