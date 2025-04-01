import { encryptedSponsors } from './encrypted_sponsors.js';

const sponsorsData = {
  data: encryptedSponsors
};

function decryptData(encryptedData) {
  try {
    const key = chrome.runtime.id;
    const decoded = atob(encryptedData.split('').reverse().join(''));
    return JSON.parse(decoded).sponsors;
  } catch (e) {
    console.error('Decryption failed');
    return {};
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSponsors") {
    sendResponse(decryptData(sponsorsData.data));
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("welcome.html")
    });
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (details.url.includes('sponsors.json')) {
      return {cancel: true};
    }
  },
  {urls: ["<all_urls>"]},
  ["blocking"]
); 