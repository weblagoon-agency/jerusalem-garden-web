/* ============================================================================
 * Jerusalem Garden — Catering Request page main JS
 * ============================================================================
 *
 * Loaded by: Page Settings (Catering Request) → Custom Code → Footer Code
 * via <script src="..."> from external hosting (Webflow Assets or jsDelivr).
 *
 * Structure of this file:
 *   SECTION 1 — CMS Nest:   fetches linked template pages and injects content
 *   SECTION 2 — Date/Time:  Flatpickr date picker + Hour/Minute selects + composite
 *   SECTION 3 — Form core:  multi-step nav, conditional toggles, accordion,
 *                           item choice, cart state, Step 3 review, pricing,
 *                           JSON serialization for submit
 *
 * Page must also have:
 *   - HTML Embed with catering-request-styles-embed.html   (CSS)
 *   - HTML Embed with catering-request-backup-embed.html   (backup tracker JS)
 *   - Page Head: Flatpickr CSS link + 'catering-ready' class toggle
 *
 * ============================================================================
 */

/* ============================================================================
 * SECTION 1 — CMS Nest
 * Fetches linked template pages and injects their content into the page.
 * ============================================================================
 */
  (function () {
    function nestSingle(link) {
      var url = link.href;
      var sourceKey = link.getAttribute('data-cms-nest-link');
      if (!url || !sourceKey) return Promise.resolve();
      return fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var source = doc.querySelector('[data-cms-nest-source="' + sourceKey + '"]');
          if (!source) {
            console.warn('CMS Nest: source not found for', sourceKey, 'on', url);
            return;
          }
          link.replaceWith(source);
        })
        .catch(function (err) {
          console.warn('CMS Nest fetch failed for', url, err);
        });
    }
    function nestAll() {
      var links = document.querySelectorAll('[data-cms-nest-link]');
      if (!links.length) return;
      var promises = Array.prototype.map.call(links, nestSingle);
      Promise.all(promises).then(function () {
        // After all items injected, recalc heights of any open accordion panels
        if (typeof window.__refreshOpenAccordions === 'function') {
          window.__refreshOpenAccordions();
        }
        document.dispatchEvent(new CustomEvent('cmsNestComplete'));
      });
    }
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(nestAll, 100);
    });
  })();

/* ============================================================================
 * SECTION 2 — Date & Time picker
 * Flatpickr (date-only) + native Hour/Minute <select> + composite #event-date-composite
 * Hours depend on day-of-week and delivery type (pickup vs delivery).
 * ============================================================================
 */
  document.addEventListener('DOMContentLoaded', function () {
    var dateTimeInput = document.querySelector('#event-datetime');
    if (!dateTimeInput) return;

    // Read current delivery type from form radios; default to 'pickup' (wider hours)
    function getDeliveryType() {
      var checked = document.querySelector('input[data-toggle-group="delivery-type"]:checked');
      return checked ? checked.value : 'pickup';
    }

    // Available hours per day-of-week and delivery type
    function getHoursForDate(date) {
      var type = getDeliveryType();
      var day = date.getDay();
      if (day === 0) return null; // Sunday closed
      if (type === 'delivery') {
        if (day === 6) return { minTime: '11:15', maxTime: '19:45' }; // Saturday
        return { minTime: '10:15', maxTime: '19:45' }; // Mon-Fri
      } else {
        // Pickup
        if (day === 6) return { minTime: '11:00', maxTime: '20:30' }; // Saturday
        return { minTime: '10:00', maxTime: '20:30' }; // Mon-Fri
      }
    }

    // === Time slot helpers ===
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function to12h(hour24, min) {
      var period = hour24 >= 12 ? 'PM' : 'AM';
      var h = hour24 % 12;
      if (h === 0) h = 12;
      return { hour: h, min: min, period: period };
    }

    function formatTimePoint(hour24, min) {
      var t = to12h(hour24, min);
      return t.hour + ':' + pad2(t.min) + ' ' + t.period;
    }

    function formatWindow(startH24, startM, endH24, endM) {
      var s = to12h(startH24, startM);
      var e = to12h(endH24, endM);
      // Compact: single AM/PM when start & end share period
      if (s.period === e.period) {
        return s.hour + ':' + pad2(s.min) + '-' + e.hour + ':' + pad2(e.min) + ' ' + s.period;
      }
      // Cross-boundary (e.g., 11:45 AM-12:00 PM): keep both AM/PM markers
      return s.hour + ':' + pad2(s.min) + ' ' + s.period + '-' + e.hour + ':' + pad2(e.min) + ' ' + e.period;
    }

    function parseHM(str) {
      var parts = str.split(':');
      return { h: parseInt(parts[0], 10), m: parseInt(parts[1], 10) };
    }

    // Populate Hour <select> based on date + delivery type. Value=24h int, display=12h.
    function populateHourMinute() {
      var hourSelect = document.getElementById('event-hour');
      var minuteSelect = document.getElementById('event-minute');
      if (!hourSelect || !minuteSelect) { updateCompositeEventDate(); return; }

      var date = picker && picker.selectedDates && picker.selectedDates[0];
      if (!date) {
        hourSelect.innerHTML = '<option value="">Hour</option>';
        minuteSelect.innerHTML = '<option value="">Min</option>';
        hourSelect.disabled = true;
        minuteSelect.disabled = true;
        updateCompositeEventDate();
        return;
      }

      var hours = getHoursForDate(date);
      if (!hours) {
        hourSelect.innerHTML = '<option value="">Closed</option>';
        minuteSelect.innerHTML = '<option value="">--</option>';
        hourSelect.disabled = true;
        minuteSelect.disabled = true;
        updateCompositeEventDate();
        return;
      }

      var type = getDeliveryType();
      var min = parseHM(hours.minTime);
      var max = parseHM(hours.maxTime);
      var minTotal = min.h * 60 + min.m;
      var maxTotal = max.h * 60 + max.m;
      // For delivery, latest valid START time = maxTotal - 15 (window must end by maxTotal)
      var effectiveMaxTotal = type === 'delivery' ? maxTotal - 15 : maxTotal;

      // Hour range: floor(minTotal/60) .. floor(effectiveMaxTotal/60)
      var firstHour = Math.floor(minTotal / 60);
      var lastHour = Math.floor(effectiveMaxTotal / 60);

      var prevHour = hourSelect.value;
      var hourOpts = ['<option value="">Hour</option>'];
      for (var h = firstHour; h <= lastHour; h++) {
        var label12 = to12h(h, 0);
        hourOpts.push('<option value="' + h + '">' + label12.hour + ' ' + label12.period + '</option>');
      }
      hourSelect.innerHTML = hourOpts.join('');
      hourSelect.disabled = false;
      if (prevHour && hourSelect.querySelector('option[value="' + prevHour + '"]')) {
        hourSelect.value = prevHour;
      }

      // Refresh minutes for the (possibly preserved) hour
      populateMinutes();
    }

    // Populate Minute <select> filtered by selected hour + bounds (00/15/30/45).
    function populateMinutes() {
      var hourSelect = document.getElementById('event-hour');
      var minuteSelect = document.getElementById('event-minute');
      if (!hourSelect || !minuteSelect) return;

      var date = picker && picker.selectedDates && picker.selectedDates[0];
      if (!date || !hourSelect.value) {
        minuteSelect.innerHTML = '<option value="">Min</option>';
        minuteSelect.disabled = true;
        updateCompositeEventDate();
        return;
      }

      var hours = getHoursForDate(date);
      if (!hours) {
        minuteSelect.innerHTML = '<option value="">--</option>';
        minuteSelect.disabled = true;
        updateCompositeEventDate();
        return;
      }

      var type = getDeliveryType();
      var selectedHour = parseInt(hourSelect.value, 10);
      var min = parseHM(hours.minTime);
      var max = parseHM(hours.maxTime);
      var minTotal = min.h * 60 + min.m;
      var maxTotal = max.h * 60 + max.m;
      var effectiveMaxTotal = type === 'delivery' ? maxTotal - 15 : maxTotal;

      var prevMin = minuteSelect.value;
      var minOpts = ['<option value="">Min</option>'];
      [0, 15, 30, 45].forEach(function (mm) {
        var totalMin = selectedHour * 60 + mm;
        if (totalMin >= minTotal && totalMin <= effectiveMaxTotal) {
          var label = mm < 10 ? '0' + mm : '' + mm;
          minOpts.push('<option value="' + mm + '">' + label + '</option>');
        }
      });
      minuteSelect.innerHTML = minOpts.join('');
      minuteSelect.disabled = false;
      if (prevMin !== '' && minuteSelect.querySelector('option[value="' + prevMin + '"]')) {
        minuteSelect.value = prevMin;
      }

      updateCompositeEventDate();
    }

    // Combine date+hour+min into #event-date-composite (pickup=exact, delivery=window).
    function updateCompositeEventDate() {
      var dateInput = document.getElementById('event-datetime');
      var hourSelect = document.getElementById('event-hour');
      var minuteSelect = document.getElementById('event-minute');
      var composite = document.getElementById('event-date-composite');
      var displayEl = document.getElementById('event-time-display');
      if (!composite) return;

      var dateVal = dateInput ? dateInput.value : '';
      var hourVal = hourSelect ? hourSelect.value : '';
      var minVal = minuteSelect ? minuteSelect.value : '';

      if (!dateVal || hourVal === '' || minVal === '') {
        composite.value = '';
        if (displayEl) {
          displayEl.textContent = '';
          displayEl.classList.remove('is-window');
        }
        composite.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      var h24 = parseInt(hourVal, 10);
      var mm = parseInt(minVal, 10);
      var type = getDeliveryType();
      var timeStr;
      var previewStr;
      if (type === 'delivery') {
        var endTotal = h24 * 60 + mm + 15;
        var endH = Math.floor(endTotal / 60);
        var endM = endTotal % 60;
        timeStr = formatWindow(h24, mm, endH, endM);
        previewStr = 'Delivery window: ' + timeStr;
      } else {
        timeStr = formatTimePoint(h24, mm);
        previewStr = 'Pickup time: ' + timeStr;
      }
      // Prepend day of week for readability in emails, Review, and backup log.
      // Format: "Saturday, 07/11/2026 5:00-5:15 PM"
      var dayOfWeek = '';
      if (picker && picker.selectedDates && picker.selectedDates[0]) {
        dayOfWeek = picker.selectedDates[0].toLocaleDateString('en-US', { weekday: 'long' });
      }
      composite.value = (dayOfWeek ? dayOfWeek + ', ' : '') + dateVal + ' ' + timeStr;
      if (displayEl) {
        displayEl.textContent = previewStr;
        displayEl.classList.add('is-window');
      }
      composite.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var picker = flatpickr(dateTimeInput, {
      enableTime: false,
      dateFormat: 'm/d/Y',
      minDate: 'today',
      disableMobile: true,
      allowInput: false,
      disable: [
        function (date) {
          return date.getDay() === 0;
        },
      ],
      onChange: function () {
        // Date changed -> regenerate hour/minute options, update composite
        populateHourMinute();
      },
    });

    // Hour select change -> refresh minute options (cascade) + update composite
    var hourSelectEl = document.getElementById('event-hour');
    if (hourSelectEl) {
      hourSelectEl.addEventListener('change', populateMinutes);
    }

    // Minute select change -> update composite directly
    var minuteSelectEl = document.getElementById('event-minute');
    if (minuteSelectEl) {
      minuteSelectEl.addEventListener('change', updateCompositeEventDate);
    }

    // Delivery type change -> regenerate hour/minute (effective max differs by type,
    // and composite preview text differs between window and exact time)
    document.addEventListener('change', function (e) {
      if (!e.target.matches('input[data-toggle-group="delivery-type"]')) return;
      populateHourMinute();
    });
  });

/* ============================================================================
 * SECTION 3 — Form core
 * Multi-step navigation, conditional toggles, accordion, cart state,
 * Step 3 review rendering, pricing (tip + delivery), and JSON serialization
 * that populates the hidden [data-order-json] field before Webflow submits.
 * ============================================================================
 */
  (function () {
    window.__cateringToggleLoaded = true;
    var currentStep = 0;
    var totalSteps = 5;
    // Visual progress bar has 4 segments (Contact, Event, Menu, Review).
    // Internal step 3 (Supplies) maps to visual "Menu" — user still on Menu category.
    var VISUAL_STEP_MAPPING = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 3 };
    var VISUAL_TOTAL_STEPS = 4;
    function visualStepIndex(internalStep) {
      return VISUAL_STEP_MAPPING[internalStep] != null ? VISUAL_STEP_MAPPING[internalStep] : 0;
    }
    // --- Conditional toggle (Pickup/Delivery etc.) ---
    function applyToggle(groupName, value) {
      var selector = '[data-show-when^="' + groupName + ':"]';
      document.querySelectorAll(selector).forEach(function (el) {
        var expected = el.getAttribute('data-show-when').split(':')[1];
        el.classList.toggle('is-visible', expected === value);
      });
      syncRequiredAttributes();
    }
    // Mark fields inside conditional blocks with their original required state.
    // Runs once on page load.
    function initRequiredTracking() {
      var fields = document.querySelectorAll('[data-show-when] input, [data-show-when] select, [data-show-when] textarea');
      fields.forEach(function (field) {
        if (!field.hasAttribute('data-original-required')) {
          var wasRequired = field.hasAttribute('required') ? 'true' : 'false';
          field.setAttribute('data-original-required', wasRequired);
        }
      });
    }
    // Add or remove `required` attribute based on whether the field's
    // conditional ancestor is currently visible.
    function syncRequiredAttributes() {
      var fields = document.querySelectorAll('[data-original-required="true"]');
      fields.forEach(function (field) {
        var hiddenParent = field.closest('[data-show-when]:not(.is-visible)');
        if (hiddenParent) {
          field.removeAttribute('required');
        } else {
          field.setAttribute('required', '');
        }
      });
    }
    function syncAllToggleGroups() {
      document.querySelectorAll('input[type="radio"][data-toggle-group]:checked').forEach(function (input) {
        applyToggle(input.dataset.toggleGroup, input.dataset.toggleValue);
      });
    }
    document.addEventListener('change', function (e) {
      if (e.target.matches('input[type="radio"][data-toggle-group]')) {
        applyToggle(e.target.dataset.toggleGroup, e.target.dataset.toggleValue);
      }
    });
    document.addEventListener('click', function (e) {
      var label = e.target.closest('label');
      var radio = label && label.querySelector('input[type="radio"][data-toggle-group]');
      if (radio) setTimeout(syncAllToggleGroups, 0);
    });
    // --- Multi-step navigation ---
    function goToStep(stepIndex) {
      if (stepIndex < 0 || stepIndex >= totalSteps) return;
      currentStep = stepIndex;
      // Show/hide step containers
      document.querySelectorAll('[data-step]').forEach(function (el) {
        el.classList.toggle('is-active', el.getAttribute('data-step') === String(stepIndex));
      });
      // Update buttons visibility
      var back = document.querySelector('[data-step-action="back"]');
      var next = document.querySelector('[data-step-action="next"]');
      var submit = document.querySelector('[data-step-action="submit"]');
      if (back) back.classList.toggle('is-hidden', stepIndex === 0);
      if (next) next.classList.toggle('is-hidden', stepIndex === totalSteps - 1);
      if (submit) submit.classList.toggle('is-hidden', stepIndex !== totalSteps - 1);
      // Update progress bar — using visual step index, not internal
      // Steps 2 (Menu items) and 3 (Supplies) both map to visual "Menu" segment,
      // so progress bar doesn't move when Menu → Supplies transition happens.
      var baseStart = 5; // % filled on the very first step
      var visualIdx = visualStepIndex(stepIndex);
      var fillPercent = baseStart + (visualIdx / (VISUAL_TOTAL_STEPS - 1)) * (100 - baseStart);
      var fill = document.querySelector('.progress-fill');
      if (fill) fill.style.width = fillPercent + '%';
      document.querySelectorAll('[data-step-label]').forEach(function (el) {
        var idx = Number(el.getAttribute('data-step-label'));
        el.classList.toggle('is-active', idx === visualIdx);
        el.classList.toggle('is-complete', idx < visualIdx);
      });
      // Scroll to top of form (smooth)
      var formTop = document.querySelector('.progress-bar') || document.querySelector('form');
      if (formTop)
        formTop.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      // If entering Step 3 (Supplies), update Cups block visibility based on cart state
      if (stepIndex === 3) {
        updateCupsBlockVisibility();
      }
      // If entering Step 4 (Review), render the review summaries
      if (stepIndex === 4) {
        updateCupsBlockVisibility();
        renderStep4();
      }
    }
    function validateCurrentStep() {
      var stepEl = document.querySelector('[data-step="' + currentStep + '"]');
      if (!stepEl) return true;
      var fields = stepEl.querySelectorAll('input[required], select[required], textarea[required]');
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        // Skip required fields inside hidden conditional blocks
        var hiddenParent = field.closest('[data-show-when]:not(.is-visible)');
        if (hiddenParent) continue;
        // Special case: readonly inputs (e.g. Flatpickr) are excluded from native
        // constraint validation, so we check value manually
        if (field.hasAttribute('readonly')) {
          if (!field.value || field.value.trim() === '') {
            // Trick: temporarily remove readonly so reportValidity can show tooltip
            field.removeAttribute('readonly');
            field.reportValidity();
            field.setAttribute('readonly', 'readonly');
            // Also focus the field so user sees where the error is
            field.focus();
            return false;
          }
          continue;
        }
        if (!field.checkValidity()) {
          field.reportValidity();
          return false;
        }
      }
      return true;
    }
    // Click handler for Back / Next
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-step-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-step-action');
      if (action === 'next') {
        e.preventDefault();
        if (!validateCurrentStep()) return;
        goToStep(currentStep + 1);
      } else if (action === 'back') {
        e.preventDefault();
        goToStep(currentStep - 1);
      }
      // 'submit' is handled by Webflow's native form submission
    });
    // Prevent Enter from submitting form on early steps
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.target.tagName === 'TEXTAREA') return;
      if (currentStep < totalSteps - 1) {
        e.preventDefault();
        var nextBtn = document.querySelector('[data-step-action="next"]');
        if (nextBtn) nextBtn.click();
      }
    });
    // Init on load
    document.addEventListener('DOMContentLoaded', function () {
      initRequiredTracking();
      syncAllToggleGroups();
      syncRequiredAttributes();
      goToStep(0);
    });
    // === Step 2: Order Style picker ===
    var ORDER_STYLE_LABELS = {
      'family-style': 'Family-Style Trays',
      individual: 'Individual Meals',
    };
    function selectOrderStyle(style) {
      if (!ORDER_STYLE_LABELS[style]) return;
      // Mark Step 2 with the chosen style
      var step2 = document.querySelector('[data-step="2"]');
      if (step2) {
        step2.classList.remove('style-family-style', 'style-individual');
        step2.classList.add('style-' + style);
        step2.classList.add('has-style-selected');
      }
      // Mark the chosen card visually
      document.querySelectorAll('[data-style-choice]').forEach(function (card) {
        card.classList.toggle('is-selected', card.getAttribute('data-style-choice') === style);
      });
      // Update banner text
      var bannerValue = document.querySelector('[data-style-banner-value]');
      if (bannerValue) bannerValue.textContent = ORDER_STYLE_LABELS[style];
      // Save current style to a hidden state (will be used by accordion + cart)
      window.__currentOrderStyle = style;
    }
    function clearOrderStyle() {
      var step2 = document.querySelector('[data-step="2"]');
      if (step2) {
        step2.classList.remove('style-family-style', 'style-individual', 'has-style-selected');
      }
      document.querySelectorAll('[data-style-choice]').forEach(function (card) {
        card.classList.remove('is-selected');
      });
      window.__currentOrderStyle = null;
    }
    // Click handler for style cards
    document.addEventListener('click', function (e) {
      var card = e.target.closest('[data-style-choice]');
      if (card) {
        e.preventDefault();
        var style = card.getAttribute('data-style-choice');
        selectOrderStyle(style);
        return;
      }
      // Click on "Change" link — confirm if cart has items
      var changeBtn = e.target.closest('[data-style-change]');
      if (changeBtn) {
        e.preventDefault();
        if (clearCart()) {
          clearOrderStyle();
        }
      }
    });
    // === Step 2: Accordion ===
    function setAccordionState(item, isOpen) {
      item.classList.toggle('is-open', isOpen);
      var panel = item.querySelector('[data-accordion-panel]');
      if (!panel) return;
      if (isOpen) {
        // Trigger transition: 0 → current scrollHeight
        panel.style.maxHeight = panel.scrollHeight + 'px';
        // After transition completes, remove the cap so content can grow freely
        // (e.g., when images finish loading or content reflows)
        setTimeout(function () {
          if (item.classList.contains('is-open')) {
            panel.style.maxHeight = 'none';
          }
        }, 350); // slightly longer than CSS transition (0.3s)
      } else {
        // Going from 'none' to 0 doesn't animate, so first lock to current height
        panel.style.maxHeight = panel.scrollHeight + 'px';
        // Force reflow so browser registers the height change
        panel.offsetHeight;
        // Then transition to 0 on next frame
        requestAnimationFrame(function () {
          panel.style.maxHeight = '0px';
        });
      }
    }
    function refreshOpenAccordions() {
      // After dynamic changes, re-measure open panels
      document.querySelectorAll('[data-accordion-item].is-open').forEach(function (item) {
        var panel = item.querySelector('[data-accordion-panel]');
        if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
      });
    }
    // Smoothly scroll the just-opened accordion trigger to top of viewport.
    // Solves mobile UX issue where opening a new section leaves the user
    // stranded in empty space due to page height shift.
    function scrollToAccordionTrigger(item) {
      var trigger = item.querySelector('[data-accordion-trigger]');
      if (!trigger) return;
      setTimeout(function () {
        var rect = trigger.getBoundingClientRect();
        var nav = document.getElementById('category-quick-nav');
        var offset = nav && nav.classList.contains('is-visible') ? 110 : 80;
        var t = Math.max(0, window.pageYOffset + rect.top - offset);
        window.scrollTo({ top: t, behavior: 'smooth' });
      }, 100);
    }
    // Expose to global scope so external scripts (CMS Nest) can call it
    window.__refreshOpenAccordions = refreshOpenAccordions;
    // Click handler for accordion triggers
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-accordion-trigger]');
      if (!trigger) return;
      var item = trigger.closest('[data-accordion-item]');
      if (!item) return;
      var isOpen = item.classList.contains('is-open');
      // If opening, close all sibling items in the same style section first
      if (!isOpen) {
        var section = item.closest('[data-style-section]');
        if (section) {
          section.querySelectorAll('[data-accordion-item].is-open').forEach(function (other) {
            if (other !== item) setAccordionState(other, false);
          });
        }
      }
      setAccordionState(item, !isOpen);
      // After opening (not closing), bring the trigger into view
      if (!isOpen) {
        scrollToAccordionTrigger(item);
      }
    });
    // Open the first accordion item of the active style on style selection
    var originalSelectOrderStyle = selectOrderStyle;
    selectOrderStyle = function (style) {
      originalSelectOrderStyle(style);
      // Wait one tick for CSS to apply visibility
      setTimeout(function () {
        var section = document.querySelector('[data-style-section="' + style + '"]');
        if (!section) return;
        // Close all items first
        section.querySelectorAll('[data-accordion-item]').forEach(function (item) {
          setAccordionState(item, false);
        });
        // Open the first one
        var firstItem = section.querySelector('[data-accordion-item]');
        if (firstItem) setAccordionState(firstItem, true);
      }, 50);
    };
    // On window resize, refresh open accordions (in case content height changed)
    window.addEventListener('resize', refreshOpenAccordions);
    // === Choice selection ===
    function selectChoice(option) {
      var card = option.closest('[data-item-slug]');
      if (!card) return;
      // Toggle .is-selected on choice options within this card
      card.querySelectorAll('.choice-option').forEach(function (opt) {
        opt.classList.toggle('is-selected', opt === option);
      });
      // Dispatch event for future cart logic (Phase C2)
      card.dispatchEvent(
        new CustomEvent('cardChoiceChange', {
          bubbles: true,
          detail: {
            slug: card.getAttribute('data-item-slug'),
            choiceIndex: option.getAttribute('data-choice-index'),
            choiceLabel: option.getAttribute('data-choice-label'),
            choicePrice: parseFloat(option.getAttribute('data-choice-price')) || 0,
          },
        }),
      );
    }
    document.addEventListener('click', function (e) {
      var option = e.target.closest('.choice-option');
      if (option) {
        e.preventDefault();
        selectChoice(option);
      }
    });
    // Pre-select first choice on items that have choices, after CMS Nest loads them
    document.addEventListener('cmsNestComplete', function () {
      document.querySelectorAll('[data-item-slug]').forEach(function (card) {
        var firstChoice = card.querySelector('.choice-option');
        if (!firstChoice) return;
        if (card.querySelector('.choice-option.is-selected')) return;
        selectChoice(firstChoice);
      });
    });
    // === Mobile category quick-nav ===
    function populateCatNav() {
      var nav = document.getElementById('category-quick-nav');
      if (!nav) return;
      var s = window.__currentOrderStyle;
      if (!s) { nav.innerHTML = '<option value="">Select order style first</option>'; return; }
      var sec = document.querySelector('[data-style-section="' + s + '"]');
      if (!sec) return;
      var opts = ['<option value="">Jump to category…</option>'];
      sec.querySelectorAll('[data-accordion-item]').forEach(function (it, i) {
        var t = it.querySelector('[data-accordion-trigger]');
        opts.push('<option value="' + i + '">' + (t ? t.textContent.trim() : 'Category ' + (i + 1)) + '</option>');
      });
      nav.innerHTML = opts.join('');
    }
    document.addEventListener('cmsNestComplete', populateCatNav);
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-style-choice]')) setTimeout(populateCatNav, 150);
    });
    // Show category nav only after scrolling to menu accordion
    window.addEventListener('scroll', function () {
      var ma = document.querySelector('[data-menu-accordion]');
      var nav = document.getElementById('category-quick-nav');
      if (!ma || !nav) return;
      nav.classList.toggle('is-visible', ma.getBoundingClientRect().top < 80);
    }, { passive: true });
    document.addEventListener('change', function (e) {
      if (e.target.id !== 'category-quick-nav') return;
      var i = parseInt(e.target.value, 10);
      var s = window.__currentOrderStyle;
      var sec = s && document.querySelector('[data-style-section="' + s + '"]');
      var item = sec && sec.querySelectorAll('[data-accordion-item]')[i];
      if (!item) return;
      var tg = item.querySelector('[data-accordion-trigger]');
      if (tg && !item.classList.contains('is-open')) tg.click();
      e.target.value = '';
    });
    // === Per-item comment block (HTML lives in CMS template / Designer) ===
    // Toggle label: empty -> "+ Add comment", filled -> "Comment" + .has-content
    function updateToggleText(wrapper) {
      if (!wrapper) return;
      var toggle = wrapper.querySelector('[data-comment-toggle]');
      if (!toggle) return;
      var input = wrapper.querySelector('[data-comment-input]');
      var hasContent = input && input.value.trim().length > 0;
      toggle.textContent = hasContent ? 'Comment' : '+ Add comment';
      wrapper.classList.toggle('has-content', hasContent);
    }
    // Show/hide by qty; preserve text on qty=0 (reappears when qty>0)
    function syncCommentWrapper(card) {
      var wrapper = card.querySelector('[data-comment-wrapper]');
      if (!wrapper) return;
      var qtyInput = card.querySelector('[data-qty-input]');
      var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 0) : 0;
      if (qty > 0) {
        wrapper.classList.add('is-active');
        updateToggleText(wrapper);
      } else {
        wrapper.classList.remove('is-active', 'is-expanded');
      }
    }
    // Click toggle -> expand (collapse via click-outside below)
    document.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-comment-toggle]');
      if (!toggle) return;
      e.preventDefault();
      var wrapper = toggle.closest('[data-comment-wrapper]');
      if (!wrapper) return;
      wrapper.classList.add('is-expanded');
      toggle.setAttribute('aria-expanded', 'true');
      var input = wrapper.querySelector('[data-comment-input]');
      if (input) setTimeout(function () { input.focus(); }, 50);
    });
    // Click outside any expanded wrapper -> collapse
    document.addEventListener('click', function (e) {
      document.querySelectorAll('[data-comment-wrapper].is-expanded').forEach(function (wrapper) {
        if (!wrapper.contains(e.target)) {
          wrapper.classList.remove('is-expanded');
          var t = wrapper.querySelector('[data-comment-toggle]');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
    });
    // Textarea input -> counter, toggle label, cart state
    document.addEventListener('input', function (e) {
      if (!e.target.matches('[data-comment-input]')) return;
      var wrapper = e.target.closest('[data-comment-wrapper]');
      if (!wrapper) return;
      var counter = wrapper.querySelector('[data-comment-counter]');
      if (counter) counter.textContent = e.target.value.length + ' / 200';
      updateToggleText(wrapper);
      var card = e.target.closest('[data-item-slug]');
      if (card) updateCartFromCard(card);
    });
    // === Cart state and updates ===
    var cart = {
      items: {},
      orderStyle: null,
    };
    window.__cartState = cart; // expose for debugging
    // Read current state of a single item card
    function readCardState(card) {
      var slug = card.getAttribute('data-item-slug');
      var name = card.getAttribute('data-item-name');
      // Quantity from qty input. (Legacy Yes/No toggle for napkins/utensils
      // removed — Supplies moved to dedicated Step 3.)
      var qtyInput = card.querySelector('[data-qty-input]');
      var qty = qtyInput ? (parseInt(qtyInput.value, 10) || 0) : 0;
      // Price: from selected choice, or base price
      var selectedChoice = card.querySelector('.choice-option.is-selected');
      var pricePerUnit = 0;
      var choiceLabel = null;
      var choiceIndex = null;
      if (selectedChoice) {
        pricePerUnit = parseFloat(selectedChoice.getAttribute('data-choice-price')) || 0;
        choiceLabel = selectedChoice.getAttribute('data-choice-label');
        choiceIndex = selectedChoice.getAttribute('data-choice-index');
      } else {
        var basePrice = parseFloat(card.getAttribute('data-item-base-price'));
        pricePerUnit = isNaN(basePrice) ? 0 : basePrice;
      }
      // Special option (e.g., "Cut in halves", "Add toasted pita chips").
      // The label text comes from the data-special-label attribute on the
      // input (set per-item in the CMS template). Empty string if not set.
      var specialInput = card.querySelector('[data-special-input]');
      var specialChecked = specialInput ? specialInput.checked : false;
      var specialLabel = specialInput ? (specialInput.getAttribute('data-special-label') || '') : '';
      // Per-item comment (200-char max, food items only)
      var commentInput = card.querySelector('[data-comment-input]');
      var comment = commentInput ? commentInput.value.trim() : '';
      return {
        slug: slug,
        name: name,
        qty: qty,
        pricePerUnit: pricePerUnit,
        choiceLabel: choiceLabel,
        choiceIndex: choiceIndex,
        specialOptionChecked: specialChecked,
        specialOptionLabel: specialLabel,
        comment: comment,
        lineTotal: Math.round(qty * pricePerUnit * 100) / 100,
      };
    }
    // Update cart from a single card's current DOM state
    function updateCartFromCard(card) {
      if (!card) return;
      var state = readCardState(card);
      if (state.qty > 0) {
        cart.items[state.slug] = state;
      } else {
        delete cart.items[state.slug];
      }
      syncCommentWrapper(card); // show/hide comment block based on qty
      renderCartBar();
      // Keep Cups block visibility in sync with 2L presence — user might be
      // on Step 2 adding/removing 2L drinks; when they later reach Step 3,
      // the Cups block will already be in the correct state.
      if (typeof updateCupsBlockVisibility === 'function') {
        updateCupsBlockVisibility();
      }
    }
    // Render the sticky cart bar
    function renderCartBar() {
      var totalItems = 0;
      var subtotal = 0;
      Object.keys(cart.items).forEach(function (slug) {
        var it = cart.items[slug];
        totalItems += it.qty;
        subtotal += it.lineTotal;
      });
      var totalEl = document.querySelector('[data-cart-total]');
      var bar = document.querySelector('[data-cart-bar]');
      if (totalEl) totalEl.textContent = '$' + subtotal.toFixed(2);
      if (bar) bar.classList.toggle('has-items', totalItems > 0);
    }
    // === Listeners that update cart ===
    // Quantity input changes (manual typing or +/− buttons fire 'input' event)
    document.addEventListener('input', function (e) {
      if (e.target.matches('[data-qty-input]')) {
        var card = e.target.closest('[data-item-slug]');
        if (card) updateCartFromCard(card);
      }
    });
    // Choice selection (we dispatch cardChoiceChange in selectChoice)
    document.addEventListener('cardChoiceChange', function (e) {
      var card = e.target.closest('[data-item-slug]') || e.target;
      if (card) updateCartFromCard(card);
    });
    // Special option checkbox change → refresh cart
    document.addEventListener('change', function (e) {
      if (e.target.matches('[data-special-input]')) {
        var card = e.target.closest('[data-item-slug]');
        if (card) updateCartFromCard(card);
      }
    });
    // === Clear cart logic ===
    function clearCart(skipConfirm) {
      var itemCount = Object.keys(cart.items).length;
      if (itemCount > 0 && !skipConfirm) {
        var msg = 'Switching the order style will clear your selection of ' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + '. Continue?';
        if (!confirm(msg)) return false;
      }
      cart.items = {};
      // Reset DOM controls (only inside menu accordion, not other inputs)
      document.querySelectorAll('[data-style-section] [data-qty-input]').forEach(function (input) {
        input.value = '';
      });
      document.querySelectorAll('[data-style-section] [data-special-input]:checked').forEach(function (cb) {
        cb.checked = false;
      });
      // Reset per-item comments
      document.querySelectorAll('[data-style-section] [data-comment-wrapper]').forEach(function (wrapper) {
        wrapper.classList.remove('is-active', 'is-expanded');
        var input = wrapper.querySelector('[data-comment-input]');
        if (input) input.value = '';
        var toggle = wrapper.querySelector('[data-comment-toggle]');
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = '+ Add comment';
        }
        var counter = wrapper.querySelector('[data-comment-counter]');
        if (counter) counter.textContent = '0 / 200';
      });
      renderCartBar();
      return true;
    }
    // === Step 3: Summary rendering ===
    // Read a value from a form field by data-summary attribute
    function readSummary(key) {
      var nodes = document.querySelectorAll('[data-summary="' + key + '"]');
      if (nodes.length === 0) return '';
      // Radio: find checked
      if (nodes[0].type === 'radio') {
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].checked) return nodes[i].value;
        }
        return '';
      }
      return (nodes[0].value || '').trim();
    }
    function writeSummary(targetKey, value) {
      var el = document.querySelector('[data-summary-target="' + targetKey + '"]');
      if (el) el.textContent = value || '—';
    }
    function renderEventSummary() {
      // Compose composite values
      var fullName = (readSummary('firstName') + ' ' + readSummary('lastName')).trim();
      writeSummary('fullName', fullName);
      writeSummary('email', readSummary('email'));
      writeSummary('phone', readSummary('phone'));
      writeSummary('bestTime', readSummary('bestTime'));
      writeSummary('company', readSummary('company') || '—');
      writeSummary('eventDate', readSummary('eventDate'));
      var deliveryType = readSummary('deliveryType');
      var typeLabel = deliveryType === 'delivery' ? 'Delivery' : deliveryType === 'pickup' ? 'Pickup' : '—';
      writeSummary('deliveryType', typeLabel);
      // Address — only relevant for delivery, build from either UofM or Other location
      var locationType = readSummary('locationType');
      var addressStr = '';
      if (locationType === 'uofm') {
        var building = readSummary('uofmBuilding');
        var uofmStreet = readSummary('uofmStreetAddress');
        // Combine building + street, e.g. "North Quad, 105 S State St"
        // Short Code intentionally NOT included here — it's shown separately
        // in the Payment Method block at the bottom of Step 3.
        addressStr = [building, uofmStreet].filter(Boolean).join(', ');
      } else if (locationType === 'other') {
        var streetAddress = readSummary('streetAddress');
        var suite = readSummary('suiteAddress');
        // If suite is filled, append it to street address with a comma
        var streetWithSuite = suite ? streetAddress + ', ' + suite : streetAddress;
        addressStr = [streetWithSuite, readSummary('city'), readSummary('zipCode')].filter(Boolean).join(', ');
      }
      writeSummary('address', addressStr);
      writeSummary('guestCount', readSummary('guestCount'));
      // Delivery contact
      var dcName = readSummary('deliveryContactName');
      var dcPhone = readSummary('deliveryContactPhone');
      var contactStr = dcName;
      if (dcPhone) contactStr += ', ' + dcPhone;
      writeSummary('deliveryContact', contactStr);
      writeSummary('deliveryInstructions', readSummary('deliveryInstructions'));
      // Toggle delivery-specific rows on Step 4 Review (formerly Step 3).
      // .is-delivery class controls visibility of Delivery Fee row, Delivery
      // Contact section, and any other delivery-only elements in Review.
      var review = document.querySelector('[data-step="4"]');
      if (review) {
        review.classList.toggle('is-delivery', deliveryType === 'delivery');
      }
    }
    function renderOrderItems() {
      var container = document.querySelector('[data-order-items]');
      if (!container) return;
      container.innerHTML = '';
      var slugs = Object.keys(cart.items);
      if (slugs.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'order-empty-state';
        empty.textContent = 'No items selected yet. Go back to Step 2 to add menu items.';
        container.appendChild(empty);
        return;
      }
      slugs.forEach(function (slug) {
        var item = cart.items[slug];
        var row = document.createElement('div');
        row.className = 'order-item-row';
        var info = document.createElement('div');
        info.className = 'order-item-row__info';
        var name = document.createElement('div');
        name.className = 'order-item-row__name';
        name.textContent = item.name + ' × ' + item.qty;
        info.appendChild(name);
        // Special option line (e.g., "Cut in halves: YES") — italic, under the name
        if (item.specialOptionChecked && item.specialOptionLabel) {
          var specialLine = document.createElement('div');
          specialLine.className = 'order-item-row__comment';
          specialLine.textContent = item.specialOptionLabel + ': YES';
          info.appendChild(specialLine);
        }
        // Per-item comment (italic line under the name)
        if (item.comment) {
          var commentLine = document.createElement('div');
          commentLine.className = 'order-item-row__comment';
          commentLine.textContent = item.comment;
          info.appendChild(commentLine);
        }
        var metaParts = [];
        if (item.choiceLabel) metaParts.push(item.choiceLabel);
        metaParts.push('$' + item.pricePerUnit.toFixed(2) + ' each');
        var meta = document.createElement('div');
        meta.className = 'order-item-row__meta';
        meta.textContent = metaParts.join(' · ');
        info.appendChild(meta);
        row.appendChild(info);
        var price = document.createElement('div');
        price.className = 'order-item-row__price';
        price.textContent = '$' + item.lineTotal.toFixed(2);
        row.appendChild(price);
        container.appendChild(row);
      });
    }
    function renderStep4() {
      renderEventSummary();
      renderOrderItems();
      renderPricing();
      renderPaymentSummary();
      renderSuppliesSummary();
    }
    // === Supplies: helpers, visibility, and Step 4 review rendering ===
    // Structure:
    //   Step 3 (Supplies) — 4 mandatory Yes/No radios: Place Settings, Napkins,
    //   Serving Utensils, Cups. Cups block is conditional on 2L drinks in cart.
    //   State persists in DOM: even if Cups block hides after 2L removed,
    //   the radio choice remains. On submit, cups only counted if 2L is present.
    function has2LDrinksInCart() {
      var slugs = Object.keys(cart.items);
      for (var i = 0; i < slugs.length; i++) {
        var item = cart.items[slugs[i]];
        if (item.qty > 0 && item.choiceLabel) {
          var label = item.choiceLabel.trim().toLowerCase();
          if (label === '2l' || label === '2 l') {
            return true;
          }
        }
      }
      return false;
    }
    // Toggle .has-2l-cart class on Cups block wrapper and Cups review row.
    // CSS hides them when .has-2l-cart is absent.
    function updateCupsBlockVisibility() {
      var show2L = has2LDrinksInCart();
      document.querySelectorAll('[data-cups-block]').forEach(function (el) {
        el.classList.toggle('has-2l-cart', show2L);
      });
      document.querySelectorAll('[data-cups-summary-row]').forEach(function (el) {
        el.classList.toggle('has-2l-cart', show2L);
      });
    }
    // Read a supply qty input value (Place Settings or Cups)
    function getSupplyQty(key) {
      var input = document.querySelector('[data-supply-qty="' + key + '"]');
      if (!input) return 0;
      return parseInt(input.value, 10) || 0;
    }
    // Total cost of paid supplies. Currently: Place Settings only ($0.40 × qty).
    function getSuppliesTotal() {
      var placeSettings = readSummary('placeSettings');
      if (placeSettings === 'yes') {
        return getSupplyQty('placeSettings') * 0.40;
      }
      return 0;
    }
    function formatSupplyYesNo(value) {
      return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '—';
    }
    function formatSupplyChoiceWithQty(value, qtyKey) {
      if (value === 'no') return 'No';
      if (value !== 'yes') return '—';
      var qty = getSupplyQty(qtyKey);
      // Place Settings are paid ($0.40 each) — show cost breakdown.
      // Cups are free — just show qty.
      if (qtyKey === 'placeSettings') {
        var cost = qty * 0.40;
        return 'Yes (' + qty + ' × $0.40 = $' + cost.toFixed(2) + ')';
      }
      return 'Yes (' + qty + ')';
    }
    // Render Supplies section in Step 4 Review
    function renderSuppliesSummary() {
      writeSummary('placeSettingsDisplay', formatSupplyChoiceWithQty(readSummary('placeSettings'), 'placeSettings'));
      writeSummary('napkinsDisplay', formatSupplyYesNo(readSummary('napkins')));
      writeSummary('servingUtensilsDisplay', formatSupplyYesNo(readSummary('servingUtensils')));
      // Cups row visibility is controlled by data-cups-summary-row .has-2l-cart via CSS
      // Fill text only if 2L is in cart (avoid showing stale value)
      if (has2LDrinksInCart()) {
        writeSummary('cupsDisplay', formatSupplyChoiceWithQty(readSummary('cups'), 'cups'));
      } else {
        writeSummary('cupsDisplay', '—');
      }
    }
    // === Supplies qty auto-fill + guest count re-sync ===
    // Track user's manual qty changes so we don't overwrite them on guest count updates.
    // Programmatic changes (auto-fill / re-sync) are wrapped in a suppression flag.
    var suppressSupplyTouched = false;
    document.addEventListener('input', function (e) {
      var input = e.target;
      if (!input || !input.getAttribute) return;
      if (!input.getAttribute('data-supply-qty')) return;
      if (suppressSupplyTouched) return;
      input.setAttribute('data-supply-qty-touched', 'true');
    });
    function setSupplyQty(qtyInput, value) {
      if (!qtyInput) return;
      suppressSupplyTouched = true;
      qtyInput.value = value;
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      suppressSupplyTouched = false;
    }
    // Auto-fill supply qty when user selects Yes (default to guest count).
    // Only prefills if qty is empty or 0 — respects user's prior manual entry.
    document.addEventListener('change', function (e) {
      var input = e.target;
      if (!input || input.type !== 'radio') return;
      var toggleGroup = input.getAttribute('data-toggle-group');
      if (toggleGroup !== 'supply-place-settings' && toggleGroup !== 'supply-cups') return;
      var toggleValue = input.getAttribute('data-toggle-value');
      if (toggleValue !== 'yes') return;
      var qtyKey = toggleGroup === 'supply-place-settings' ? 'placeSettings' : 'cups';
      var qtyInput = document.querySelector('[data-supply-qty="' + qtyKey + '"]');
      if (!qtyInput) return;
      if (!qtyInput.value || qtyInput.value === '0') {
        var guestCount = readSummary('guestCount');
        if (guestCount) {
          setSupplyQty(qtyInput, guestCount);
        }
      }
    });
    // Guest count change → re-sync auto-filled supplies qty (untouched only).
    // If the user manually adjusted a supply qty, it stays as-is.
    document.addEventListener('input', function (e) {
      var input = e.target;
      if (!input || !input.getAttribute) return;
      if (input.getAttribute('data-summary') !== 'guestCount') return;
      var guestCount = parseInt(input.value, 10);
      if (!guestCount || guestCount < 1) return;
      document.querySelectorAll('[data-supply-qty]').forEach(function (qtyInput) {
        if (qtyInput.getAttribute('data-supply-qty-touched') === 'true') return;
        var key = qtyInput.getAttribute('data-supply-qty');
        var choice = readSummary(key);
        if (choice !== 'yes') return;
        setSupplyQty(qtyInput, guestCount);
      });
    });
    // === Review "Edit" links — jump to a specific step ===
    // Any element with data-step-jump="N" navigates to internal step N when clicked.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-step-jump]');
      if (!btn) return;
      e.preventDefault();
      var target = parseInt(btn.getAttribute('data-step-jump'), 10);
      if (!isNaN(target)) {
        goToStep(target);
      }
    });
    // === Step 3: Payment summary (at the bottom, under Estimated Total) ===
    // Two targets in DOM:
    //   [data-summary-target="paymentMethod"]  — method line ("Short Code: ..." | "Credit Card")
    //                                            its parent <div data-show-when="location-type:uofm">
    //                                            is auto-hidden for non-UofM customers by the
    //                                            existing toggle system, so we just fill the text.
    //   [data-summary-target="paymentNote"]    — reassurance note, varies by chosen method
    function renderPaymentSummary() {
      var locType = readSummary('locationType');
      var paymentMethod = readSummary('paymentMethod');
      var shortCode = readSummary('shortCode');
      var methodText = '—';
      var noteText = '';
      if (locType === 'uofm') {
        if (paymentMethod === 'short-code') {
          methodText = 'Short Code: ' + (shortCode || '—');
          noteText = 'Your Short Code will only be charged after we confirm your order by phone.';
        } else if (paymentMethod === 'credit-card') {
          methodText = 'Credit Card';
          noteText = 'Your card details will be collected by phone when we confirm your order.';
        }
      } else if (locType === 'other') {
        // Method line is hidden by data-show-when for non-UofM; only the note renders.
        noteText = 'Your payment details will be collected by phone when we confirm your order.';
      }
      writeSummary('paymentMethod', methodText);
      writeSummary('paymentNote', noteText);
    }
    // === Tip + Pricing ===
    var tipState = {
      mode: null, // 'percent' or 'flat'
      percent: 0,
      flat: 0,
    };
    // Parse composite date (plain/window/cross-boundary). Returns START Date.
    // Composite may optionally start with a weekday prefix (e.g., "Saturday, ")
    // which is stripped before parsing the m/d/Y date part.
    function parseEventDateTime(dateStr) {
      if (!dateStr) return null;
      var trimmed = dateStr.trim();
      // Strip optional "Weekday, " prefix — kept for display only.
      trimmed = trimmed.replace(/^[A-Za-z]+,\s*/, '');
      var match = trimmed.match(/^(\S+)\s+(.+)$/);
      if (!match) return null;
      var datePart = match[1];
      var timePart = match[2];
      // Cross-boundary window: "11:45 AM-12:00 PM"
      var cross = timePart.match(/^(\d{1,2}:\d{2})\s*([AP]M)\s*-\s*\d{1,2}:\d{2}\s*[AP]M$/);
      var startTime;
      if (cross) {
        startTime = cross[1] + ' ' + cross[2];
      } else {
        // Same-period window: "10:15-10:30 AM"
        var win = timePart.match(/^(\d{1,2}:\d{2})\s*-\s*\d{1,2}:\d{2}\s+([AP]M)$/);
        if (win) {
          startTime = win[1] + ' ' + win[2];
        } else {
          // Plain time: "10:15 AM"
          startTime = timePart;
        }
      }
      var dateParts = datePart.split('/');
      var stMatch = startTime.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
      if (dateParts.length !== 3 || !stMatch) return null;
      var month = parseInt(dateParts[0], 10);
      var day = parseInt(dateParts[1], 10);
      var year = parseInt(dateParts[2], 10);
      var hours = parseInt(stMatch[1], 10);
      var minutes = parseInt(stMatch[2], 10);
      var meridiem = stMatch[3].toUpperCase();
      // Convert 12-hour to 24-hour
      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      return new Date(year, month - 1, day, hours, minutes);
    }
    // Delivery fee: Mon-Fri <3PM $24, ≥3PM $32; Sat $32; Sun closed.
    function getDeliveryFee() {
      if (readSummary('deliveryType') !== 'delivery') return 0;
      var date = parseEventDateTime(readSummary('eventDate'));
      if (!date) return 0;
      var dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      var hours = date.getHours();
      if (dayOfWeek === 6) return 32; // Saturday — all day
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        return hours < 15 ? 24 : 32; // Mon-Fri — before/after 3pm
      }
      return 0; // Sunday (shouldn't happen) or invalid
    }
    function calculateTip(subtotal) {
      if (tipState.mode === 'percent') return subtotal * (tipState.percent / 100);
      if (tipState.mode === 'flat') return tipState.flat;
      return 0;
    }
    function renderPricing() {
      var foodSubtotal = 0;
      Object.keys(cart.items).forEach(function (slug) {
        foodSubtotal += cart.items[slug].lineTotal;
      });
      var supplies = getSuppliesTotal();
      // Paid supplies (Place Settings) are part of the order — include them
      // in subtotal so tip, total, and displayed subtotal all match up.
      var subtotal = foodSubtotal + supplies;
      var tip = calculateTip(subtotal);
      var deliveryFee = getDeliveryFee();
      var total = subtotal + tip + deliveryFee;
      var subEl = document.querySelector('[data-pricing-subtotal]');
      var tipEl = document.querySelector('[data-pricing-tip]');
      var delEl = document.querySelector('[data-pricing-delivery]');
      var totEl = document.querySelector('[data-pricing-total]');
      var supEl = document.querySelector('[data-pricing-supplies]'); // optional line
      if (subEl) subEl.textContent = '$' + subtotal.toFixed(2);
      if (tipEl) tipEl.textContent = '$' + tip.toFixed(2);
      if (delEl) delEl.textContent = '$' + deliveryFee.toFixed(2);
      if (totEl) totEl.textContent = '$' + total.toFixed(2);
      if (supEl) supEl.textContent = '$' + supplies.toFixed(2);
      // Stash on cart for JSON serialization (round to 2 decimals to avoid
      // floating-point artifacts like 9.600000000000001 in the email).
      cart.foodSubtotal = Math.round(foodSubtotal * 100) / 100;
      cart.subtotal = Math.round(subtotal * 100) / 100;
      cart.tip = Math.round(tip * 100) / 100;
      cart.deliveryFee = deliveryFee;
      cart.supplies = Math.round(supplies * 100) / 100;
      cart.total = Math.round(total * 100) / 100;
    }
    // Tip option clicks
    document.addEventListener('click', function (e) {
      var opt = e.target.closest('.tip-option');
      if (!opt) return;
      document.querySelectorAll('.tip-option').forEach(function (other) {
        other.classList.toggle('is-selected', other === opt);
      });
      var mode = opt.getAttribute('data-tip-mode');
      var customWrapper = document.querySelector('[data-tip-custom-wrapper]');
      if (mode === 'percent') {
        tipState.mode = 'percent';
        tipState.percent = parseInt(opt.getAttribute('data-tip-value'), 10) || 0;
        if (customWrapper) customWrapper.classList.remove('is-visible');
      } else if (mode === 'flat') {
        tipState.mode = 'flat';
        if (customWrapper) {
          customWrapper.classList.add('is-visible');
          var input = customWrapper.querySelector('[data-tip-flat-input]');
          if (input) {
            tipState.flat = parseFloat(input.value) || 0;
            setTimeout(function () {
              input.focus();
            }, 50);
          }
        }
      }
      renderPricing();
    });
    // Flat amount input typed
    document.addEventListener('input', function (e) {
      if (!e.target.matches('[data-tip-flat-input]')) return;
      if (tipState.mode !== 'flat') return;
      tipState.flat = parseFloat(e.target.value) || 0;
      renderPricing();
    });
    // Wipe values in hidden conditional blocks before submit (clean Webflow email).
    function clearInactiveConditionalFields() {
      document.querySelectorAll('[data-show-when]:not(.is-visible)').forEach(function (block) {
        var fields = block.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], textarea, select');
        fields.forEach(function (field) {
          field.value = '';
        });
      });
    }
    // === JSON serialization for form submit ===
    function buildOrderJson() {
      return {
        orderStyle: window.__currentOrderStyle || null,
        eventDetails: {
          firstName: readSummary('firstName'),
          lastName: readSummary('lastName'),
          email: readSummary('email'),
          phone: readSummary('phone'),
          bestTime: readSummary('bestTime'),
          company: readSummary('company'),
          eventDate: readSummary('eventDate'),
          deliveryType: readSummary('deliveryType'),
          locationType: readSummary('locationType'),
          // Only include UofM fields if locationType is 'uofm'
          uofmBuilding: readSummary('locationType') === 'uofm' ? readSummary('uofmBuilding') : '',
          uofmStreetAddress: readSummary('locationType') === 'uofm' ? readSummary('uofmStreetAddress') : '',
          shortCode: readSummary('locationType') === 'uofm' ? readSummary('shortCode') : '',
          // Payment method only applies to UofM customers (radio is inside UofM block).
          // Values: 'short-code' | 'credit-card' | '' (other location → handled by phone)
          paymentMethod: readSummary('locationType') === 'uofm' ? readSummary('paymentMethod') : '',
          // Only include Other-location fields if locationType is 'other'
          streetAddress: readSummary('locationType') === 'other' ? readSummary('streetAddress') : '',
          suiteAddress: readSummary('locationType') === 'other' ? readSummary('suiteAddress') : '',
          city: readSummary('locationType') === 'other' ? readSummary('city') : '',
          zipCode: readSummary('locationType') === 'other' ? readSummary('zipCode') : '',
          guestCount: readSummary('guestCount'),
          deliveryContactName: readSummary('deliveryContactName'),
          deliveryContactPhone: readSummary('deliveryContactPhone'),
          deliveryInstructions: readSummary('deliveryInstructions'),
        },
        items: Object.keys(cart.items).map(function (slug) {
          var it = cart.items[slug];
          return {
            slug: it.slug,
            name: it.name,
            qty: it.qty,
            choiceLabel: it.choiceLabel,
            specialOption: it.specialOptionChecked,
            specialOptionLabel: it.specialOptionLabel || '',
            pricePerUnit: it.pricePerUnit,
            lineTotal: it.lineTotal,
            comment: it.comment || '',
          };
        }),
        pricing: {
          foodSubtotal: cart.foodSubtotal || 0,   // food items only
          suppliesTotal: cart.supplies || 0,       // paid supplies (Place Settings)
          subtotal: cart.subtotal || 0,            // foodSubtotal + suppliesTotal
          tipMode: tipState.mode,
          tipPercent: tipState.mode === 'percent' ? tipState.percent : 0,
          tipFlat: tipState.mode === 'flat' ? tipState.flat : 0,
          tipAmount: cart.tip || 0,
          deliveryFee: cart.deliveryFee || 0,
          total: cart.total || 0,
        },
        supplies: (function () {
          var placeSettingsYes = readSummary('placeSettings') === 'yes';
          var cupsApplicable = has2LDrinksInCart();
          var cupsYes = cupsApplicable && readSummary('cups') === 'yes';
          return {
            placeSettings: {
              included: placeSettingsYes,
              qty: placeSettingsYes ? getSupplyQty('placeSettings') : 0,
              cost: placeSettingsYes ? getSupplyQty('placeSettings') * 0.40 : 0,
            },
            napkins: readSummary('napkins') === 'yes',
            servingUtensils: readSummary('servingUtensils') === 'yes',
            cups: {
              applicable: cupsApplicable,
              included: cupsYes,
              qty: cupsYes ? getSupplyQty('cups') : 0,
            },
          };
        })(),
        comments: readSummary('orderComments') || '',
      };
    }
    // Form submit: runs before Webflow (capture phase) to fill hidden JSON field
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      clearInactiveConditionalFields();
      var hf = form.querySelector('[data-order-json]');
      if (!hf) return;
      hf.value = JSON.stringify(buildOrderJson(), null, 2);
    }, true);
  })();

/* ============================================================================
 * SECTION 4 — Phone input masks (XXX-XXX-XXXX)
 * Applies a consistent US phone format to all phone inputs on the page.
 * Requires the IMask library (loaded via CDN in Page Footer Code).
 * Targets the customer phone (Step 0) and the delivery contact phone (Step 1).
 * ============================================================================
 */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof IMask === 'undefined') {
    console.warn('Catering: IMask library not loaded — skipping phone mask init.');
    return;
  }
  // Targets: any <input type="tel"> or any input whose name contains "Phone"
  var phoneInputs = document.querySelectorAll('input[type="tel"], input[name*="Phone"]');
  phoneInputs.forEach(function (el) {
    IMask(el, {
      mask: '000-000-0000'
    });
  });

  // Short Code mask: exactly 6 digits.
  // IMask restricts typing to digits only + max 6 characters. HTML5 pattern="\d{6}"
  // set on the input in Designer enforces MINIMUM 6 (blocks submit with fewer digits).
  document.querySelectorAll('input[data-summary="shortCode"]').forEach(function (el) {
    IMask(el, {
      mask: '000000'
    });
  });
});
