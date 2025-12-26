#!/usr/bin/env node
/**
 * Test ExerciseDB API
 */

const API_KEY = 'a404975499mshd431c84bef0985fp1ac6bdjsn486157400cf7';

async function testAPI() {
  console.log('Testing ExerciseDB API...\n');
  
  // Test different endpoints
  const endpoints = [
    'https://exercisedb.p.rapidapi.com/exercises/name/bench%20press',
    'https://exercisedb.p.rapidapi.com/exercises',
    'https://exercisedb.p.rapidapi.com/exercises/search?name=bench%20press',
  ];
  
  for (const url of endpoints) {
    console.log(`Testing: ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': API_KEY,
          'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com'
        }
      });
      
      console.log(`Status: ${response.status}`);
      console.log(`Headers:`, Object.fromEntries(response.headers.entries()));
      
      if (response.ok) {
        const data = await response.json();
        console.log(`Response type: ${Array.isArray(data) ? 'Array' : typeof data}`);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`First item keys:`, Object.keys(data[0]));
          console.log(`Sample:`, JSON.stringify(data[0], null, 2).substring(0, 500));
        } else {
          console.log(`Data:`, JSON.stringify(data, null, 2).substring(0, 500));
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

