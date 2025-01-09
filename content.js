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
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.jobs-job-board-list__item',
      '.job-card-list__entity-lockup',
      '.jobs-search-results-grid__card-item'
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
        '.job-card-container__company-name',
        '.job-card-container__primary-description',
        '.company-name',
        '.job-card-list__company-name',
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__company-link'
      ];

      // Expanded list of selectors for job titles
      const titleSelectors = [
        '.job-card-container__link',
        '.job-card-list__title',
        '.jobs-unified-top-card__job-title',
        '.artdeco-entity-lockup__title',
        '.job-card-list__entity-lockup a'
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

    // Find all job cards
    const jobCards = document.querySelectorAll('[data-job-id]');
    
    // Find the matching job card
    for (const card of jobCards) {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      if (link && (link.href === request.url || link.textContent.includes(request.title))) {
        console.log('Found matching job card');
        
        // Scroll into view
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Click the link after a short delay
        setTimeout(() => {
          link.click();
        }, 500);
        
        break;
      }
    }
    
    sendResponse();
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
  
  // And again after a short delay
  setTimeout(() => {
    processSponsors();
    processLanguages();
  }, 500);
}

// Adds visual indicators to job cards:
// - Green background for sponsored companies
// - Resets background to white for non-sponsored companies
function processSponsors() {
  console.log('Processing sponsors...');
  const cards = document.querySelectorAll('.job-card-container, [data-job-id], .jobs-search-results__list-item');
  console.log('Found cards:', cards.length);
  
  cards.forEach(card => {
    // Updated company selectors
    const companyElement = card.querySelector([
      '.job-card-container__company-name',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.company-name',
      '.job-card-list__company-name',
      '[data-tracking-control-name="public_jobs_company_name"]'
    ].join(', '));
    
    if (companyElement) {
      const companyName = companyElement.textContent.split('·')[0].trim();
      if (checkIfSponsor(companyName)) {
        card.style.backgroundColor = 'rgb(230 243 234)';
      } else {
        card.style.backgroundColor = 'white';
      }
    }
  });
}

// Adds language badges to job titles:
// - KM badge for Known Member (sponsor) companies
// - EN badge for jobs posted in English
function processLanguages() {
  const cards = document.querySelectorAll('.job-card-container, [data-job-id], .jobs-search-results__list-item');
  
  cards.forEach(card => {
    if (card.dataset.processed) return;
    card.dataset.processed = 'true';

    const titleElement = card.querySelector([
      '.job-card-container__link span',
      '.job-card-list__title',
      '.jobs-unified-top-card__job-title',
      '.job-card-list__title-link',
      '[data-tracking-control-name="public_jobs_jserp_job_link"]',
      'a[href*="/jobs/view/"] span',
      'h3.base-search-card__title'
    ].join(', '));

    if (titleElement && !titleElement.querySelector('.language-indicator')) {
      // Get company name for sponsor check
      const companyElement = card.querySelector([
        '.job-card-container__company-name',
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__primary-description',
        '.company-name',
        '.job-card-list__company-name',
        '[data-tracking-control-name="public_jobs_company_name"]'
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