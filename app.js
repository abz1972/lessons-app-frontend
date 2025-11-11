// My Vue 3 app that connects the frontend to my backend API
const app = Vue.createApp({
  data() {
    return {
      // This is where my backend lives (Render link)
      // All my fetch requests will use this as a base
      apiBase: 'https://lessons-app-backend.onrender.com/api',

      // My page control – I switch between subjects, locations, and checkout
      view: 'subjects',

      // The user’s search input
      searchQuery: '',

      // Sorting controls for the subjects page
      subjectsSortDir: 'asc', // asc = A–Z, desc = Z–A

      // Sorting controls for the locations page
      sortOption: 'location', // what to sort by (subject, location, price, spaces)
      sortDir: 'asc',         // sorting direction

      // My lessons data (fetched from MongoDB)
      lessons: [],

      // Stores which subject the user clicked on
      selectedSubject: null,

      // My shopping cart (each item is a lesson + city + price)
      cart: [],

      // The customer’s checkout details
      customer: { name: '', phone: '' },

      // Message shown after placing an order
      orderMessage: '',

      // Suggestions for live search
      suggestions: []
    };
  },
  
  computed: {
    // I filter and sort all lessons by what the user types
    orderedFilteredLessons() {
      const term = this.searchQuery.toLowerCase();

      // Only show lessons or cities that include the search term
      const filtered = this.lessons.filter(lesson => {
        if (!term) return true; // if search is empty, show everything
        const subjectMatch = lesson.subject?.toLowerCase().includes(term);
        const cityMatch = lesson.locations?.some(loc => loc.city?.toLowerCase().includes(term));
        return subjectMatch || cityMatch;
      });

      // Then I sort alphabetically (A–Z or Z–A)
      const sorted = [...filtered].sort((a, b) =>
        a.subject.localeCompare(b.subject, undefined, { sensitivity: 'base' })
      );

      return this.subjectsSortDir === 'asc' ? sorted : sorted.reverse();
    },

    // I sort the selected subject’s locations by the chosen key (city, price, spaces, etc.)
    sortedLocations() {
      if (!this.selectedSubject) return [];
      const dir = this.sortDir === 'asc' ? 1 : -1;

      // Each sort option knows what to compare
      const keyFn = {
        subject: () => (this.selectedSubject?.subject || '').toLowerCase(),
        location: (l) => (l.city || '').toLowerCase(),
        price: (l) => Number(l.price) || 0,
        spaces: (l) => Number(l.spaces) || 0
      }[this.sortOption] || ((l) => (l.city || '').toLowerCase());

      // Return a sorted copy
      const arr = [...this.selectedSubject.locations];
      return arr.sort((a, b) => {
        const av = keyFn(a), bv = keyFn(b);
        if (av > bv) return 1 * dir;
        if (av < bv) return -1 * dir;
        return 0;
      });
    },

    // I group the cart by subject + city to calculate quantity
    groupedCart() {
      const map = new Map();
      for (const item of this.cart) {
        const key = `${item.subject}|${item.city}`;
        if (!map.has(key)) map.set(key, { ...item, quantity: 0 });
        map.get(key).quantity++;
      }
      return Array.from(map.values());
    },

    // Count of all items in my cart
    cartCount() { return this.cart.length; },

    // Total cost of everything in my cart
    cartTotal() { return this.cart.reduce((sum, i) => sum + (Number(i.price) || 0), 0); },

    // Validation: I only allow checkout if name/phone are valid and cart isn’t empty
    isCheckoutValid() {
      const nameOk = /^[a-zA-Z ]+$/.test(this.customer.name);
      const phoneOk = /^[0-9]+$/.test(this.customer.phone);
      return nameOk && phoneOk && this.cart.length > 0;
    }
  },

  methods: {
    // Change between my app’s views (Subjects, Locations, Checkout)
    go(page) { this.view = page; },

    // --- Image path normalizer for live hosting ---
    // I make sure lesson.image like "images/maths.png" becomes "/images/maths.png"
    // so it loads from the site root on the deployed frontend.
    normalizeImage(p) {
      if (!p) return '';
      if (/^https?:\/\//i.test(p)) return p;      // already absolute URL
      if (p.startsWith('/')) return p;            // already root-based
      return '/' + p.replace(/^\.?\/*/, '');      // ensure exactly one leading slash
    },

    // Fetch lessons from my backend API
    async loadLessons() {
      try {
        const res = await fetch(`${this.apiBase}/lessons`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.lessons = await res.json();
      } catch (e) {
        console.error('Failed to load lessons:', e);
        alert('Could not load lessons. Is the API running?');
      }
    },

    // When I click a subject, store it and move to the Locations page
    selectSubject(lesson) {
      this.selectedSubject = lesson;
      this.view = 'locations';
    },

    // Add one seat for the selected city to my cart and decrease available spaces
    addToCart(loc) {
      const found = this.selectedSubject.locations.find(l => l.city === loc.city);
      if (!found) return;

      if (found.spaces <= 0) {
        alert('Sorry, this location is out of stock.');
        return;
      }

      // Take one space away and add to my cart
      found.spaces -= 1;
      this.cart.push({
        subject: this.selectedSubject.subject,
        city: loc.city,
        price: loc.price
      });
    },

    // Remove one seat and add it back to the lesson’s spaces
    removeOne(item) {
      const idx = this.cart.findIndex(i => i.subject === item.subject && i.city === item.city);
      if (idx !== -1) {
        this.cart.splice(idx, 1);
        const lesson = this.lessons.find(l => l.subject === item.subject);
        if (lesson) {
          const loc = lesson.locations.find(l => l.city === item.city);
          if (loc) loc.spaces += 1;
        }
      }
    },

    // Remove all seats for one subject+city and restore all spaces
    removeAll(item) {
      const count = this.cart.filter(i => i.subject === item.subject && i.city === item.city).length;
      this.cart = this.cart.filter(i => !(i.subject === item.subject && i.city === item.city));
      const lesson = this.lessons.find(l => l.subject === item.subject);
      if (lesson) {
        const loc = lesson.locations.find(l => l.city === item.city);
        if (loc) loc.spaces += count;
      }
    },

    // This is my full checkout logic:
    // I send the order to the backend, then update lesson spaces in the DB
    async checkout() {
      if (!this.isCheckoutValid) return;

      // Build an order object with everything I need
      const payload = {
        name: this.customer.name.trim(),
        phone: this.customer.phone.trim(),
        items: this.groupedCart.map(g => ({
          subject: g.subject,
          city: g.city,
          price: g.price,
          quantity: g.quantity
        })),
        total: this.cartTotal
      };

      try {
        // Send order to backend
        const postRes = await fetch(`${this.apiBase}/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!postRes.ok) throw new Error('Order failed.');

        // Update spaces for each subject/city (so database stays accurate)
        await Promise.all(this.groupedCart.map(item => {
          const lesson = this.lessons.find(l => l.subject === item.subject);
          const loc = lesson?.locations?.find(l => l.city === item.city);
          const spaces = loc?.spaces;
          if (spaces == null) return Promise.resolve();
          return fetch(`${this.apiBase}/lessons`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: item.subject,
              city: item.city,
              spaces: spaces
            })
          });
        }));

        // Show confirmation message and reset everything
        const result = await postRes.json().catch(() => ({}));
        this.orderMessage = result.message || 'Order submitted!';
        this.cart = [];
        this.customer = { name: '', phone: '' };
        await this.loadLessons(); // make sure my data matches the database
        this.view = 'checkout';
      } catch (e) {
        console.error(e);
        alert('There was a problem submitting your order.');
      }
    },

    // Update live search suggestions based on what the user types
    updateSuggestions() {
      const term = this.searchQuery.toLowerCase();
      if (!term) { this.suggestions = []; return; }

      const subjects = this.lessons
        .map(l => l.subject)
        .filter(s => s?.toLowerCase().includes(term));

      const cities = this.lessons
        .flatMap(l => l.locations.map(loc => loc.city))
        .filter(c => c?.toLowerCase().includes(term));

      // Combine both and remove duplicates
      this.suggestions = [...new Set([...subjects, ...cities].filter(Boolean))].slice(0, 6);
    },

    // When I click a suggestion, fill the search bar with it
    applySuggestion(v) {
      this.searchQuery = v;
      this.suggestions = [];
    }
  },

  // When the app first loads, I fetch all lessons from the backend
  mounted() {
    this.loadLessons();
  }
});

// Finally, I attach my app to the #app div in index.html
app.mount('#app');
