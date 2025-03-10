document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Query tabs in a more specific way
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
      currentWindow: true
    });

    // Safety check
    if (!tabs || tabs.length === 0) {
      document.getElementById('summary').textContent = 'Unable to access current tab';
      return;
    }

    const tab = tabs[0];
    
    // Update URL check for both LinkedIn and Indeed
    if (!tab.url || !(tab.url.includes('linkedin.com') || tab.url.includes('indeed.com'))) {
      const summaryElement = document.getElementById('summary');
      const jobSites = [
        { name: 'LinkedIn', url: 'https://www.linkedin.com/jobs/collections/' },
        { name: 'Indeed', url: 'https://www.indeed.com' }
      ];
      
      const siteLinks = jobSites
        .map(site => `<a href="${site.url}" target="_blank">${site.name}</a>`)
        .join(' or ');

      const message = `Welcome to the KMatch extension.<br><br>To use the extension, please visit ${siteLinks}`;
      const sponsorListLink = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants';
      const linkText = 'Complete sponsor list';

      summaryElement.innerHTML = `
        ${message}<br><br>
        ${linkText}:<br> <a href="${sponsorListLink}" target="_blank">${sponsorListLink}</a>
      `;
      return;
    }

    // Safety check for URL
    if (!tab?.url) {
      document.getElementById('summary').textContent = 'Unable to access tab URL';
      return;
    }

    // Helper function to remove duplicated text
    function removeDuplicateText(text) {
      if (!text) return '';
      
      // First clean the text
      let cleanText = text.trim()
                         .replace(/\s+/g, ' ')        // Replace multiple spaces with single space
                         .replace(/\([^)]*\)/g, '')   // Remove content in parentheses
                         .replace(/·.*$/, '')         // Remove everything after ·
                         .replace(/,.*$/, '')         // Remove everything after comma
                         .replace(/EN/g, '')          // Remove 'EN' from the text
                         .replace(/KM/g, '')          // Remove 'KM' from the text
                         .replace(/with verification/g, '')  // Remove 'with verification'
                         .trim();

      // Split into words and remove duplicates
      const words = cleanText.split(' ');
      const uniqueWords = [...new Set(words)];
      
      // If we removed duplicates, use the unique words
      if (uniqueWords.length < words.length) {
        return uniqueWords.join(' ');
      }
      
      // If no word-level duplicates, check for repeated phrases
      const halfLength = Math.floor(words.length / 2);
      const firstHalf = words.slice(0, halfLength).join(' ').toLowerCase();
      const secondHalf = words.slice(halfLength).join(' ').toLowerCase();
      
      if (firstHalf === secondHalf) {
        return words.slice(0, halfLength).join(' ');
      }
      
      return cleanText;
    }

    // Cache object to store job descriptions
    const descriptionCache = new Map();

    // Function to perform initial language detection on job titles
    function detectLanguageFromTitles(jobs) {
      jobs.forEach(job => {
        const title = job.jobTitle; // Assuming job has a jobTitle property
        const detectedLanguage = performLanguageDetection(title); // Your language detection logic
        console.log(`Detected language for title "${title}": ${detectedLanguage}`);
      });
    }

    // Function to handle job card click
    function handleJobClick(job) {
      const jobUrl = job.url; // Assuming job.url contains the job's URL

      // Check if the description is already cached
      if (descriptionCache.has(jobUrl)) {
        const cachedDescription = descriptionCache.get(jobUrl);
        const detectedLanguage = performLanguageDetection(cachedDescription); // Use the cached description
        console.log(`Detected language for cached description: ${detectedLanguage}`);
      } else {
        // Fetch the job description (this is a placeholder for your actual fetching logic)
        fetchJobDescription(jobUrl).then(description => {
          // Store the fetched description in the cache
          descriptionCache.set(jobUrl, description);
          const detectedLanguage = performLanguageDetection(description); // Use the newly fetched description
          console.log(`Detected language for newly fetched description: ${detectedLanguage}`);
        });
      }
    }

    // Placeholder function to fetch job description
    function fetchJobDescription(url) {
      return new Promise((resolve, reject) => {
        // Simulate an asynchronous fetch operation
        setTimeout(() => {
          // Replace this with actual fetching logic
          const fetchedDescription = "Sample job description for " + url; // Simulated description
          resolve(fetchedDescription);
        }, 1000);
      });
    }

    // Function to perform language detection
    function performLanguageDetection(text) {
      // Your language detection logic here
      // For example, return a dummy language based on the text length
      return text.length > 50 ? 'English' : 'Unknown'; // Simplified example
    }

    // Example job data (this would typically come from your job fetching logic)
    const jobs = [
      { jobTitle: "Software Engineer", url: "https://example.com/job/12345" },
      { jobTitle: "Data Scientist", url: "https://example.com/job/67890" }
    ];

    // Initial language detection on page load
    detectLanguageFromTitles(jobs);

    // Simulate a job card click
    handleJobClick(jobs[0]); // Click on the first job

    chrome.tabs.sendMessage(tab.id, { action: "getJobsInfo" }, response => {
      if (chrome.runtime.lastError) {
        document.getElementById('summary').textContent = 'Unable to check companies. Please refresh the page.';
        return;
      }

      if (response && response.jobs) {
        const sponsorJobs = response.jobs.filter(job => job.isSponsor);
        
        document.getElementById('summary').innerHTML = 
          `Found ${sponsorJobs.length} out of ${response.jobs.length} jobs with visa sponsorship.<br>Scroll down the webpage to see more.`;

        const companyListElement = document.getElementById('company-list');
        response.jobs.forEach((job, index) => {
          // Clean up company name
          const cleanCompanyName = job.companyName
            .split('·')[0]
            .replace(/\([^)]*\)/g, '')
            .replace(/\s*·.*$/, '')
            .replace(/\s+Area.*$/, '')
            .replace(/,.*$/, '')
            .trim();

          // Clean up job title
          const roleType = removeDuplicateText(job.jobTitle || '');
          
          const jobElement = document.createElement('div');
          jobElement.className = `job-item ${job.isSponsor ? 'sponsor' : 'not-sponsor'}`;
          jobElement.style.position = 'relative';
          
          jobElement.innerHTML = `
    <div class="job-header">
      <div class="company-info" style="display: flex; justify-content: space-between; align-items: center;">
        <div class="job-title" style="color: ${job.isSponsor ? '#000' : '#666'}; font-weight: 700; font-size: 14px;">
          ${roleType}
        </div>
        <div style="display: flex; gap: 4px;">
          ${job.isSponsor ? '<span style="background-color: #0a66c2; color: white; padding: 1px 3px; border-radius: 2px; vertical-align: top; position: relative; top: 0px; border: 1px solid #0a66c2; font-weight: bold; font-size: 9px;">KM</span>' : ''}
          ${job.isEnglish ? '<span style="background-color: white; color: #0a66c2; padding: 1px 3px; border-radius: 2px; vertical-align: top; position: relative; top: 0px; border: 1px solid #0a66c2; font-weight: bold; font-size: 9px;">EN</span>' : ''}
        </div>
      </div>
    </div>
    <div style="color: ${job.isSponsor ? '#000' : '#666'}; font-size: 13px; margin-top: 4px;">
      ${cleanCompanyName}
    </div>
  `;
          
          jobElement.addEventListener('click', () => {
            // Get the job URL from the job object
            const jobUrl = job.url;
            const isIndeed = jobUrl.includes('indeed.com');
            
            console.log('Clicking job:', {
              title: roleType,
              url: jobUrl,
              platform: isIndeed ? 'indeed' : 'linkedin'
            });

            // Send message to content script with platform info
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "scrollToJob",
                url: jobUrl,
                title: roleType,
                platform: isIndeed ? 'indeed' : 'linkedin'
              }, () => {
                window.close();
              });
            });
          });
          
          companyListElement.appendChild(jobElement);
        });
      }
    });
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('summary').textContent = 'An error occurred: ' + error.message;
  }
});