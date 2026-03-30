const API_KEY = "ak_97ad5b13635ddc6a3d6ed8b5aee71e08132612b2c3613de6";
const BASE_URL = "https://assessment.ksensetech.com/api";

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      // 1. Catch the 500/503 Intermittent Failures
      if (response.status >= 500) {
        console.warn(`Server Error (${response.status}) on attempt ${i + 1}. Retrying...`);
        // Wait a short moment before retrying (optional but recommended)
        await new Promise(res => setTimeout(res, 500));
        continue; // Jump to the next iteration of the loop
      }

      // 2. Handle Rate Limiting (429) if it occurs
      if (response.status === 429) {
        console.warn("Rate limited. Waiting 1 second...");
        await new Promise(res => setTimeout(res, 1000));
        continue;
      }

      // 3. Catch other non-OK responses (like 404 or 401)
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      // If everything is fine, return the data
      return await response.json();

    } catch (err) {
      // 4. Catch Network/Connection errors
      if (i === retries - 1) {
        console.error("Max retries reached. Request failed.");
        throw err;
      }
      console.log(`Connection error, retrying... (${i + 1}/${retries})`);
    }
  }
}

async function runAssessment() {
  let allPatients = [];
  let currentPage = 1;
  let hasNext = true;

  console.log("Fetching patients...");

  // 1. Pagination Loop
  while (hasNext) {
    console.log(`Fetching page ${currentPage}...`);
    const result = await fetchWithRetry(`${BASE_URL}/patients?page=${currentPage}`, {
      headers: { "x-api-key": API_KEY }
    });

    if (!result) break;

    // 1. FLEXIBLE DATA EXTRACTION
    // Check for 'data' OR 'patients'
    const pageData = result.data || result.patients;
    
    if (pageData && Array.isArray(pageData)) {
      allPatients = allPatients.concat(pageData);
    }

    // 2. FLEXIBLE PAGINATION CHECK
    // The standard format has result.pagination.hasNext
    // The "Error" format you just got doesn't seem to have a hasNext, 
    // so we calculate it manually: current_page * per_page < total_records
    if (result.pagination) {
      hasNext = result.pagination.hasNext;
    } else if (result.current_page && result.total_records) {
      hasNext = (result.current_page * result.per_page) < result.total_records;
    } else {
      hasNext = false; // Stop if we can't figure out the next page
    }

    currentPage++;
    await new Promise(res => setTimeout(res, 200)); 
  }

  const results = {
    high_risk_patients: [],
    fever_patients: [],
    data_quality_issues: []
  };

  // 2. Processing Logic
  allPatients.forEach(p => {
    let isInvalid = false;
    let bpScore = 0;
    let tempScore = 0;
    let ageScore = 0;

    // --- Blood Pressure ---
    if (!p.blood_pressure || typeof p.blood_pressure !== 'string' || !p.blood_pressure.includes('/')) {
      isInvalid = true;
    } else {
      const [sys, dia] = p.blood_pressure.split('/').map(Number);
      if (isNaN(sys) || isNaN(dia)) isInvalid = true;
      else {
        if (sys >= 140 || dia >= 90) bpScore = 3;
        else if (sys >= 130 || dia >= 89) bpScore = 2;
        else if (sys >= 120 && dia < 80) bpScore = 1;
      }
    }

    // --- Temperature ---
    const temp = parseFloat(p.temperature);
    if (isNaN(temp)) {
      isInvalid = true;
    } else {
      if (temp >= 99.6) results.fever_patients.push(p.patient_id);
      if (temp >= 101.0) tempScore = 2;
      else if (temp >= 99.6) tempScore = 1;
    }

    // --- Age ---
    const age = parseInt(p.age);
    if (isNaN(age)) {
      isInvalid = true;
    } else {
      if (age > 65) ageScore = 2;
      else if (age >= 40) ageScore = 1;
    }

    // 3. Final Categorization
    if (isInvalid) {
      results.data_quality_issues.push(p.patient_id);
    } else if ((bpScore + tempScore + ageScore) >= 4) {
      results.high_risk_patients.push(p.patient_id);
    }
  });

  // 4. Submit
  console.log("Submitting results...", results);
  const submitResponse = await fetchWithRetry(`${BASE_URL}/submit-assessment`, {
    method: 'POST',
    headers: { 
      "x-api-key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(results)
  });

  console.log("Response:", submitResponse);
}

runAssessment();