#!/usr/bin/env node
/**
 * Test MuscleWiki API structure
 */

const API_KEY = 'a404975499mshd431c84bef0985fp1ac6bdjsn486157400cf7';
const API_HOST = 'musclewiki-api.p.rapidapi.com';

async function testAPI() {
  console.log('Testing MuscleWiki API structure...\n');
  
  // Test different endpoints
  const endpoints = [
    'https://musclewiki-api.p.rapidapi.com/exercises',
    'https://musclewiki-api.p.rapidapi.com/exercises?name=barbell%20curl',
    'https://musclewiki-api.p.rapidapi.com/exercises/search?q=barbell%20curl',
    'https://musclewiki-api.p.rapidapi.com/exercises/barbell-curl',
  ];
  
  for (const url of endpoints) {
    console.log(`Testing: ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': API_KEY,
          'X-RapidAPI-Host': API_HOST
        }
      });
      
      console.log(`Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`Response type: ${Array.isArray(data) ? 'Array' : typeof data}`);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`Array length: ${data.length}`);
          console.log(`First item keys:`, Object.keys(data[0]));
          console.log(`Sample:`, JSON.stringify(data[0], null, 2).substring(0, 1000));
        } else if (typeof data === 'object') {
          console.log(`Object keys:`, Object.keys(data));
          console.log(`Sample:`, JSON.stringify(data, null, 2).substring(0, 1000));
        }
        break; // Success, stop testing
      } else {
        const error = await response.text();
        console.log(`Error: ${error.substring(0, 200)}\n`);
      }
    } catch (err) {
      console.error(`Exception: ${err.message}\n`);
    }
  }
}

testAPI().catch(console.error);

