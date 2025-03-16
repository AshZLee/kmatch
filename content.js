console.log('Content script loaded');

// Map to store recognized sponsor companies and their variations
// This is loaded from sponsors.json and used for highlighting sponsored companies
let recognizedSponsors = new Map();

// Cache for storing language detection results to avoid redundant processing
const jobLanguageCache = new Map();

// Load sponsors from JSON file
fetch(chrome.runtime.getURL('sponsors.json'))
  .then(response => response.json())
  .then(data => {
    // Convert the JSON object into a Map
    Object.entries(data.sponsors).forEach(([key, variations]) => {
      recognizedSponsors.set(key, variations);
    });
    console.log('Sponsors loaded:', recognizedSponsors.size);
  })
  .catch(error => console.error('Error loading sponsors:', error));

// Main message handler for extension communication
// Handles two types of messages:
// 1. getJobsInfo: Collects job listing information from the page
// 2. scrollToJob: Scrolls to and clicks a specific job listing
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getJobsInfo") {
    const jobs = [];
    
    // Expanded list of selectors for job cards
    const jobCardSelectors = [
      // LinkedIn selectors
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.jobs-job-board-list__item',
      '.job-card-list__entity-lockup',
      '.jobs-search-results-grid__card-item',
      // Indeed selectors
      '.mainContentTable',
      '[data-testid="job-card"]',
      '.job_seen_beacon'
    ];
    
    // Try each selector
    let jobCards = [];
    jobCardSelectors.forEach(selector => {
      const cards = document.querySelectorAll(selector);
      console.log(`Selector ${selector} found ${cards.length} cards`);
      if (cards.length > 0) {
        jobCards = cards;
      }
    });

    console.log('Total job cards found:', jobCards.length);

    jobCards.forEach(card => {
      // Expanded list of selectors for company names
      const companySelectors = [
        // LinkedIn selectors
        '.job-card-container__company-name',
        '.job-card-container__primary-description',
        '.company-name',
        '.job-card-list__company-name',
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__company-link',
        // Indeed selectors
        '[data-testid="company-name"]',
        '.companyName',
        '.company'
      ];

      // Expanded list of selectors for job titles
      const titleSelectors = [
        // LinkedIn selectors
        '.job-card-container__link',
        '.job-card-list__title',
        '.jobs-unified-top-card__job-title',
        '.artdeco-entity-lockup__title',
        '.job-card-list__entity-lockup a',
        // Indeed selectors
        '.jcs-JobTitle',
        '.jobTitle a',
        '[data-testid="jobTitle"]'
      ];

      let companyElement = null;
      let titleElement = null;

      // Try each company selector
      for (const selector of companySelectors) {
        companyElement = card.querySelector(selector);
        if (companyElement) {
          console.log(`Found company with selector: ${selector}`);
          break;
        }
      }

      // Try each title selector
      for (const selector of titleSelectors) {
        titleElement = card.querySelector(selector);
        if (titleElement) {
          console.log(`Found title with selector: ${selector}`);
          break;
        }
      }

      if (companyElement && titleElement) {
        const fullCompanyName = companyElement.textContent.trim();
        const companyName = fullCompanyName.split('·')[0].trim();
        const jobTitle = titleElement.textContent.trim();
        const url = titleElement.href || window.location.href;
        
        console.log('Found job:', { 
          companyName, 
          jobTitle,
          cleanedName: cleanCompanyName(companyName),
          isSponsor: checkIfSponsor(companyName)
        });
        
        jobs.push({
          companyName,
          jobTitle,
          isSponsor: checkIfSponsor(companyName),
          url,
          isEnglish: isEnglishText(jobTitle, card)
        });
      } else {
        console.log('Missing elements:', {
          hasCompany: !!companyElement,
          hasTitle: !!titleElement
        });
      }
    });

    console.log('Sending response with jobs:', jobs.length);
    sendResponse({ jobs });
    return true;
  } else if (request.action === "scrollToJob") {
    console.log('Received scroll request:', request);
    
    if (request.platform === 'indeed') {
      // Indeed-specific job card finding
      const jobCards = document.querySelectorAll('table.mainContentTable');
      let targetCard;

      jobCards.forEach(card => {
        const titleLink = card.querySelector('h2.jobTitle a, a.jcs-JobTitle');
        if (titleLink) {
          const cardUrl = titleLink.href;
          const cardTitle = titleLink.textContent.trim();

          console.log('Checking card:', { cardUrl, cardTitle, requestUrl: request.url, requestTitle: request.title });

          // Check both URL and title for matching
          if (cardUrl === request.url || cardTitle === request.title) {
            targetCard = card;
          }
        }
      });

      if (targetCard) {
        console.log('Found target card, scrolling...');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Highlight the card temporarily
        const originalBackground = targetCard.style.backgroundColor;
        targetCard.style.backgroundColor = '#e8f0fe';
        setTimeout(() => {
          targetCard.style.backgroundColor = originalBackground;
        }, 2000);

        // Click the job title link
        const titleLink = targetCard.querySelector('h2.jobTitle a, a.jcs-JobTitle');
        if (titleLink) {
          titleLink.click();
        }
      }
    } else {
      // LinkedIn logic
      const jobCards = document.querySelectorAll('.job-card-container');
      jobCards.forEach(card => {
        const link = card.querySelector('a');
        if (link && (link.href === request.url || link.textContent.trim() === request.title)) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          link.click();
        }
      });
    }
    
    sendResponse({ success: true });
    return true;
  }
  return true; // Keep the message channel open for async responses
});

// Cleans company names by removing common business suffixes and special characters
// This helps with matching variations of company names more accurately
function cleanCompanyName(name) {
  if (!name) return '';
  
  return name.toLowerCase()
    .replace(/b\.v\.|n\.v\.|inc\.|corp\.|corporation|ltd\.|holding|netherlands|trading|group|international/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Checks if a company is a recognized sponsor by comparing against loaded sponsor list
// Performs both exact and fuzzy matching to catch variations in company names
function checkIfSponsor(companyName) {
  if (!companyName || recognizedSponsors.size === 0) return false;
  
  const cleanName = cleanCompanyName(companyName);
  const originalName = companyName.trim();

  for (const [, variations] of recognizedSponsors) {
    // Check exact matches first (case insensitive)
    if (variations.some(variant => 
      variant.toLowerCase() === originalName.toLowerCase() ||
      originalName.toLowerCase().includes(variant.toLowerCase())
    )) {
      return true;
    }

    // Check cleaned variations
    const matchedVariation = variations.some(variant => {
      const cleanVariant = cleanCompanyName(variant);
      return cleanName.includes(cleanVariant) || cleanVariant.includes(cleanName);
    });

    if (matchedVariation) return true;
  }

  return false;
}

// Main processing function that handles both sponsor highlighting and language detection
// Called on page load, scroll, and DOM mutations
function processPage() {
  // Process both features immediately
  processSponsors();
  processLanguages();
  markViewedJobs();
  
  // And again after a short delay
  setTimeout(() => {
    processSponsors();
    processLanguages();
    markViewedJobs();
  }, 500);
}

// Adds visual indicators to job cards:
// - Green background for sponsored companies
// - Resets background to white for non-sponsored companies
function processSponsors() {
  console.log('Processing sponsors...');
  // Add more specific Indeed selectors
  const cards = document.querySelectorAll([
    // LinkedIn selectors
    '.job-card-container',
    '[data-job-id]',
    '.jobs-search-results__list-item',
    // Indeed selectors
    'table.mainContentTable',
    'div[class*="job_seen_beacon"]',
    'td.resultContent'
  ].join(', '));
  
  console.log('Found cards:', cards.length);
  
  cards.forEach(card => {
    // Updated company selectors for Indeed
    const companyElement = card.querySelector([
      // LinkedIn selectors
      '.job-card-container__company-name',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.company-name',
      // Indeed selectors
      '[data-testid="company-name"]',
      'span[class*="companyName"]',
      'div[class*="company_location"] span'
    ].join(', '));
    
    if (companyElement) {
      const companyName = companyElement.textContent.split('·')[0].trim();
      console.log('Processing company:', companyName);
      if (checkIfSponsor(companyName)) {
        // For Indeed, we need to style the parent table
        const parentCard = card.closest('table.mainContentTable') || card;
        parentCard.style.backgroundColor = 'rgb(230 243 234)';
      } else {
        const parentCard = card.closest('table.mainContentTable') || card;
        parentCard.style.backgroundColor = 'white';
      }
    }
  });
}

// Adds language badges to job titles:
// - KM badge for Known Member (sponsor) companies
// - EN badge for jobs posted in English
function processLanguages() {
  const cards = document.querySelectorAll([
    // LinkedIn selectors
    '.job-card-container',
    '[data-job-id]',
    '.jobs-search-results__list-item',
    // Indeed selectors
    'table.mainContentTable',
    'div[class*="job_seen_beacon"]',
    'td.resultContent'
  ].join(', '));
  
  cards.forEach(card => {
    if (card.dataset.processed) return;
    card.dataset.processed = 'true';

    // Updated title selectors for Indeed
    const titleElement = card.querySelector([
      // LinkedIn selectors
      '.job-card-container__link span',
      '.job-card-list__title',
      // Indeed selectors
      '.jobTitle span[id^="jobTitle"]',
      'h2.jobTitle a',
      'a.jcs-JobTitle'
    ].join(', '));

    if (titleElement && !titleElement.querySelector('.language-indicator')) {
      // Get company name for sponsor check
      const companyElement = card.querySelector([
        // LinkedIn selectors
        '.job-card-container__company-name',
        '.artdeco-entity-lockup__subtitle',
        // Indeed selectors
        '[data-testid="company-name"]',
        'span[class*="companyName"]',
        'div[class*="company_location"] span'
      ].join(', '));

      const companyName = companyElement ? companyElement.textContent.split('·')[0].trim() : '';
      const isSponsor = checkIfSponsor(companyName);

      // Create badge container
      const badgeContainer = document.createElement('span');
      badgeContainer.style.marginLeft = '6px';

      // Add KM badge first if sponsor
      if (isSponsor) {
        const kmBadge = createBadge('KM');
        badgeContainer.appendChild(kmBadge);
      }

      // Add EN badge if English
      if (isEnglishText(titleElement.textContent, card)) {
        const enBadge = createBadge('EN');
        if (badgeContainer.firstChild) {
          enBadge.style.marginLeft = '4px';
        }
        badgeContainer.appendChild(enBadge);
      }

      if (badgeContainer.children.length > 0) {
        titleElement.appendChild(document.createTextNode(' '));
        titleElement.appendChild(badgeContainer);
      }
    }
  });
}

// Utility function to create consistent badge styling
// Used for both KM (blue background) and EN (white background) badges
function createBadge(text) {
  const badge = document.createElement('span');
  badge.className = 'language-indicator';
  const isKM = text === 'KM';
  const backgroundColor = isKM ? '#0a66c2' : 'white';
  const textColor = isKM ? 'white' : '#0a66c2';
  badge.style.cssText = `
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    background-color: ${backgroundColor} !important;
    color: ${textColor} !important;
    font-size: 11px !important;
    font-weight: bold !important;
    padding: 2px 4px !important;
    border-radius: 3px !important;
    vertical-align: middle !important;
    line-height: normal !important;
    ${!isKM ? 'border: 1px solid #0a66c2 !important;' : ''}
  `;
  badge.textContent = text;
  return badge;
}

// Language detection using common Dutch words and patterns
// Returns false if Dutch words/patterns are found, true otherwise
// Used to determine if a job posting is in English
function isEnglishText(text, card) {
  // First try to find the job description
  const descriptionElement = card.querySelector([
    '.job-card-container__description',
    '.job-description',
    '.job-card-list__description',
    '[data-job-description]',
    '.show-more-less-html__markup'
  ].join(', '));

  // If we have a description, use that for language detection
  if (descriptionElement) {
    const description = descriptionElement.textContent.trim();
    if (description) {
      return checkEnglishWords(description);
    }
  }

  // Fall back to title only if no description is available
  return checkEnglishWords(text);
}

// Split out the original word checking logic
function checkEnglishWords(text) {
  const dutchWords = [
    // Common Dutch words (removed words that are also common in English)
    'wij', 'zijn', 'zoeken', 'voor', 'een', 'met', 'het', 'van', 'naar',
    'werkzaamheden', 'taken', 'vereisten', 'over', 'ons', 'bij',
    'ervaring', 'kennis', 'binnen', 'als', 'wat',
    'bieden', 'jouw', 'onze', 'deze', 'door', 'wordt', 'bent',
    // Dutch-specific job titles
    'medewerker', 'aangiftemedewerker', 'administratief', 'beheerder',
    'adviseur', 'verkoper', 'directeur',
    'ondersteuning', 'assistent', 'hoofd', 'leider', 'stagiair',
    'vacature', 'gezocht', 'gevraagd',
    // Add medical/healthcare specific Dutch words
    'verpleegkundig', 'specialist', 'epilepsie', 'zorg', 'arts',
    'behandelaar', 'therapeut', 'apotheek', 'huisarts', 'tandarts',
    'verpleging', 'verzorging', 'patiënt', 'kliniek', 'ziekenhuis',
    'medisch', 'paramedisch', 'fysiotherapeut', 'psycholoog'
  ];

  const dutchPatterns = [
    'medewerker',
    'beheerder',
    'adviseur',
    'aangifte',
    'administratie',
    'zorg',
    'dienst',
    'kundige',
    'programma',
    'werkstudent',
    'uur/week',
    'ontwikkelaar',   // for Front-endontwikkelaar
    'analist',        // for Data-analist
    'consulent',      // for marketingconsulent
    'etalagist',      // for Etalagiste
    'centraal',       // for Centraal Nederland
    'consulent',
    'verpleeg',
    'kundig',
    'medisch',
    'zorg',
    'arts',
    'therapie',
    'marketeer',
    'communicatiespecialist',
    'strategie',
    'stafafdelingen'
  ];

  const text_lower = text.toLowerCase()
    .replace(/[\s\-\/]+/g, '');
  
  if (dutchPatterns.some(pattern => text_lower.includes(pattern))) {
    return false;
  }

  const words = text_lower.split(/\s+/);
  const dutchWordCount = words.filter(word => dutchWords.includes(word)).length;
  
  return dutchWordCount === 0;
}

// URL change detection
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('URL changed, reprocessing...');
    setTimeout(processPage, 1000);
  }
}).observe(document.body, { subtree: true, childList: true });

// Multiple trigger points
document.addEventListener('DOMContentLoaded', processPage);
window.addEventListener('load', processPage);
document.addEventListener('scroll', () => {
  requestAnimationFrame(processPage);
});

// Observer for dynamic content
let observerTimeout;
const observer = new MutationObserver((mutations) => {
  if (mutations.some(mutation => mutation.addedNodes.length > 0)) {
    if (observerTimeout) clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => {
      processPage();
    }, 100);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false
});

// Initial call
processPage();

// Process on scroll (debounced)
let scrollTimeout;
document.addEventListener('scroll', () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    processLanguages();
  }, 100);
});

// Add this new function
function markViewedJobs() {
  const currentUrl = window.location.href;
  const cards = document.querySelectorAll([
    // LinkedIn selectors
    '.job-card-container',
    '[data-job-id]',
    '.jobs-search-results__list-item',
    // Indeed selectors
    'table.mainContentTable',
    'div[class*="job_seen_beacon"]',
    'td.resultContent'
  ].join(', '));
  
  cards.forEach(card => {
    // Add click listener to each card
    card.addEventListener('click', () => {
      const titleElement = card.querySelector([
        // LinkedIn selectors
        '.job-card-container__link',
        '.job-card-list__title',
        // Indeed selectors
        '.jobTitle a',
        'a.jcs-JobTitle'
      ].join(', '));

      if (titleElement?.href) {
        const viewedJobs = JSON.parse(localStorage.getItem('viewedJobs') || '[]');
        if (!viewedJobs.includes(titleElement.href)) {
          viewedJobs.push(titleElement.href);
          localStorage.setItem('viewedJobs', JSON.stringify(viewedJobs));
        }
        
        // Apply grey background immediately after click
        const parentCard = card.closest('table.mainContentTable') || card;
        if (!parentCard.style.backgroundColor.includes('rgb(230 243 234)')) {
          parentCard.style.backgroundColor = '#f5f5f5';
        }
      }
    }, { once: true }); // Ensure listener is only added once

    // Also check if this card was previously viewed
    const titleElement = card.querySelector([
      // LinkedIn selectors
      '.job-card-container__link',
      '.job-card-list__title',
      // Indeed selectors
      '.jobTitle a',
      'a.jcs-JobTitle'
    ].join(', '));

    const cardUrl = titleElement?.href;
    const viewedJobs = JSON.parse(localStorage.getItem('viewedJobs') || '[]');
    if (cardUrl && viewedJobs.includes(cardUrl)) {
      const parentCard = card.closest('table.mainContentTable') || card;
      if (!parentCard.style.backgroundColor.includes('rgb(230 243 234)')) {
        parentCard.style.backgroundColor = '#f5f5f5';
      }
    }
  });
}

// Ensure markViewedJobs runs on URL changes
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('URL changed, marking viewed jobs...');
    setTimeout(markViewedJobs, 500);
  }
}).observe(document, { subtree: true, childList: true });

// Function to check and highlight Dutch-related content
function highlightDutchContent(element) {
  if (!element) return;
  
  const text = element.textContent.toLowerCase();
  const preferencesContainer = document.querySelector('.job-details-preferences-and-skills');
  const jobTitleContainer = document.querySelector('.jobs-unified-top-card__job-title');
  
  if (text.includes('nederlandse') || text.includes('dutch')) {
    if (preferencesContainer) {
      let dutchPill = preferencesContainer.querySelector('.dutch-requirement-pill');
      if (!dutchPill) {
        dutchPill = document.createElement('div');
        dutchPill.className = 'job-details-preferences-and-skills__pill dutch-requirement-pill';
        dutchPill.setAttribute('tabindex', '0');
        dutchPill.setAttribute('role', 'presentation');
        dutchPill.innerHTML = `
          <span class="ui-label text-body-small" style="background-color: #ffebee; color: #d32f2f; padding: 4px 8px; border-radius: 4px;">
            <span aria-hidden="true"><strong>⛔ Dutch Required</strong></span>
            <span class="visually-hidden">Dutch language is required for this position</span>
          </span>
        `;
        preferencesContainer.appendChild(dutchPill);
      }
      
      if (jobTitleContainer && !jobTitleContainer.querySelector('.dutch-indicator')) {
        const sidebarIndicator = document.createElement('span');
        sidebarIndicator.className = 'dutch-indicator';
        sidebarIndicator.innerHTML = `
          <span style="
            color: black;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            margin-left: 8px;
          ">
            <strong>⛔ Dutch</strong>
          </span>
        `;
        jobTitleContainer.appendChild(sidebarIndicator);
      }
    }
  } else {
    // Remove indicators if no Dutch content
    const dutchPill = document.querySelector('.dutch-requirement-pill');
    if (dutchPill) {
      dutchPill.remove();
    }
    const titleIndicator = document.querySelector('.dutch-indicator');
    if (titleIndicator) {
      titleIndicator.remove();
    }
  }
}

// Keep the existing observer setup
const dutchContentObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
      if (mutation.target.closest('#job-details')) {
          const jobDescription = document.querySelector('#job-details div p');
          highlightDutchContent(jobDescription);
      }
  });
});

function startObserving() {
  const targetNode = document.querySelector('#job-details');
  if (targetNode) {
      dutchContentObserver.observe(targetNode, {
          childList: true,
          subtree: true,
          characterData: true
      });
      
      // Check initial content
      const jobDescription = document.querySelector('#job-details div p');
      highlightDutchContent(jobDescription);
  }
}

// Initialize observer and add click handler
document.addEventListener('DOMContentLoaded', startObserving);

document.addEventListener('click', (event) => {
  setTimeout(() => {
      const jobDescription = document.querySelector('#job-details div p');
      highlightDutchContent(jobDescription);
  }, 500);
});

// Function to add new time filter options
function addTimeFilterOptions() {
    // Find the time filter list
    const timeFilterList = document.querySelector('ul.list-style-none.relative.search-reusables__collection-values-container');
    if (!timeFilterList) return;

    if (timeFilterList.querySelector('[data-kmatch-time-filter]')) {
        updateSelectedState();
        return;
    }

    timeFilterList.innerHTML = '';

    // Define all options
    const allOptions = [
        { value: '86400', text: 'Past 24 hours' },
        { value: '172800', text: 'Past 2 days' },
        { value: '259200', text: 'Past 3 days' },
        { value: '345600', text: 'Past 4 days' },
        { value: '432000', text: 'Past 5 days' },
        { value: '604800', text: 'Past week' },
        { value: '2592000', text: 'Past month' }
    ];

    // Create and insert all options
    allOptions.forEach(opt => {
        const li = document.createElement('li');
        li.className = 'search-reusables__collection-values-item';
        li.setAttribute('data-kmatch-time-filter', opt.value);
        li.innerHTML = `
            <input name="date-posted-filter-value" 
                   id="timePostedRange-r${opt.value}" 
                   class="search-reusables__select-input" 
                   type="radio" 
                   value="r${opt.value}">
            <label for="timePostedRange-r${opt.value}" class="search-reusables__value-label">
                <p class="display-flex">
                    <span class="t-14 t-black--light t-normal" aria-hidden="true">
                        ${opt.text}
                    </span>
                    <span class="visually-hidden">
                        Filter by ${opt.text}
                    </span>
                </p>
            </label>
        `;

        // Add click handler
        const input = li.querySelector('input');
        input.addEventListener('change', (e) => {
            if (e.target.checked) {
                updateButtonText(opt.text);
                
                // Update URL and reload
                const currentUrl = new URL(window.location.href);
                currentUrl.searchParams.set('f_TPR', e.target.value);
                window.location.href = currentUrl.toString();
            }
        });

        timeFilterList.appendChild(li);
    });

    // Update initial state
    updateSelectedState();
}

// Helper function to update button text
function updateButtonText(text) {
    const filterButton = document.querySelector('#searchFilter_timePostedRange');
    if (!filterButton) return;

    Array.from(filterButton.childNodes)
        .filter(node => node.nodeType === 3)
        .forEach(node => node.remove());

    const textNode = document.createTextNode(text);
    
    const svgIcon = filterButton.querySelector('svg');
    
    if (svgIcon) {
        filterButton.insertBefore(textNode, svgIcon);
    } else {
        filterButton.appendChild(textNode);
    }
}

// Helper function to update selected state
function updateSelectedState() {
    const currentUrl = window.location.href;
    const timeFilterList = document.querySelector('ul.list-style-none.relative.search-reusables__collection-values-container');
    if (!timeFilterList) return;

    const selectedInput = timeFilterList.querySelector('input[type="radio"]:checked');
    if (selectedInput) {
        const text = selectedInput.closest('li').querySelector('.t-14').textContent.trim();
        updateButtonText(text);
        return;
    }

    const inputs = timeFilterList.querySelectorAll('input[type="radio"]');
    inputs.forEach(input => {
        if (currentUrl.includes(input.value)) {
            input.checked = true;
            const text = input.closest('li').querySelector('.t-14').textContent.trim();
            updateButtonText(text);
        }
    });
}

const filterObserver = new MutationObserver((mutations) => {
    if (filterObserver.timeout) {
        clearTimeout(filterObserver.timeout);
    }
    
    filterObserver.timeout = setTimeout(() => {
        const timeFilterList = document.querySelector('ul.list-style-none.relative.search-reusables__collection-values-container');
        if (timeFilterList && !timeFilterList.querySelector('[data-kmatch-time-filter]')) {
            addTimeFilterOptions();
        }
    }, 100);
});

// Start observing
filterObserver.observe(document.body, {
    childList: true,
    subtree: true
});