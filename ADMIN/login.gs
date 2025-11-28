// This script implements a simple token-based authentication service 
// using Google Sheets as a database for users and sessions.

// =====================================================================
// ===== CONFIGURATION & GLOBALS (MUST BE UPDATED ON DEPLOYMENT) =====
// =====================================================================

// IMPORTANT: When deploying this as a Web App, ensure you run the 
// `setupDatabase` function manually from the bound sheet first.

const USERS_SHEET = "Users";
const SESSIONS_SHEET = "Sessions";
const TOKEN_EXPIRY_HOURS = 24;

// Global variable to hold the spreadsheet object. 
// We initialize it using the active spreadsheet for setup/testing 
// and handle deployment access in the functions.
let ss = SpreadsheetApp.getActiveSpreadsheet();


// =====================================================================
// ===== SETUP & UTILITY FUNCTIONS =====
// =====================================================================

/**
 * Sets up or clears the Users and Sessions sheets in the active spreadsheet.
 * MUST be run manually once after attaching the script to a sheet.
 */
function setupDatabase() {
  // Use the active spreadsheet where the script is bound. 
  // This prevents the common 'openById' permission error.
  const setupSs = SpreadsheetApp.getActiveSpreadsheet();
  
  // Create Users sheet
  let usersSheet = setupSs.getSheetByName(USERS_SHEET);
  if (!usersSheet) {
    usersSheet = setupSs.insertSheet(USERS_SHEET, 0);
  } else {
    usersSheet.clear();
  }
  
  // Set up Users table headers
  usersSheet.getRange("A1:C1").setValues([
    ["Username", "Password", "Status"]
  ]);
  
  // Add sample users
  const sampleData = [
    ["kue_paul", "kuepaul@123", "active"],
    ["user1", "password123", "active"]
  ];
  usersSheet.getRange("A2:C3").setValues(sampleData);
  
  // Format Users sheet
  usersSheet.setColumnWidth(1, 150);
  usersSheet.setColumnWidth(2, 150);
  usersSheet.setColumnWidth(3, 100);
  usersSheet.getRange("A1:C1").setFontWeight("bold").setBackground("#4285F4").setFontColor("white");
  usersSheet.getRange("A1:C1").setHorizontalAlignment("center");
  
  // Create Sessions sheet
  let sessionsSheet = setupSs.getSheetByName(SESSIONS_SHEET);
  if (!sessionsSheet) {
    sessionsSheet = setupSs.insertSheet(SESSIONS_SHEET, 1);
  } else {
    sessionsSheet.clear();
  }
  
  // Set up Sessions table headers
  sessionsSheet.getRange("A1:D1").setValues([
    ["Username", "Token", "Expiry", "Created Date"]
  ]);
  
  sessionsSheet.setColumnWidth(1, 150);
  sessionsSheet.setColumnWidth(2, 350);
  sessionsSheet.setColumnWidth(3, 200);
  sessionsSheet.setColumnWidth(4, 200);
  sessionsSheet.getRange("A1:D1").setFontWeight("bold").setBackground("#34A853").setFontColor("white");
  sessionsSheet.getRange("A1:D1").setHorizontalAlignment("center");
  
  // Protect sheets (optional)
  // protectSheet(usersSheet);
  // protectSheet(sessionsSheet);
  
  SpreadsheetApp.getUi().alert("✓ Database setup complete!\n\nSpreadsheet ID: " + setupSs.getId());
}

/**
 * Generates a cryptographically strong, unique token.
 * @return {string} A UUID token.
 */
function generateToken() {
  return Utilities.getUuid();
}

/**
 * Calculates the token expiry date.
 * @param {number} hoursFromNow The number of hours until expiry.
 * @return {Date} The expiry date object.
 */
function getExpiryDate(hoursFromNow = TOKEN_EXPIRY_HOURS) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hoursFromNow);
  return expiry;
}

/**
 * Fetches data from a specified sheet, skipping the header row.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @return {Array<Array<any>>} The sheet data without the header.
 */
function getSheetData(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length > 1) {
    return values.slice(1); // Skip header row
  }
  return [];
}


// =====================================================================
// ===== MAIN API HANDLER (doPost) =====
// =====================================================================

/**
 * Handles POST requests to the Web App URL for login, validation, and logout.
 * @param {GoogleAppsScript.Events.DoPost} e The request object.
 * @return {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function doPost(e) {
  // Use the spreadsheet associated with the Web App deployment
  const activeSs = SpreadsheetApp.getActiveSpreadsheet(); 

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    let response = {};

    switch (action) {
      case "login":
        response = authenticateUser(activeSs, data.username, data.password);
        break;
      case "validateToken":
        response = validateToken(activeSs, data.token);
        break;
      case "logout":
        response = logoutUser(activeSs, data.token);
        break;
      case "getUserInfo":
        response = getUserInfo(activeSs, data.token);
        break;
      default:
        response = { success: false, error: "Invalid action" };
    }

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // Log the error for debugging
    Logger.log("doPost Error: " + error.message);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Server error: " + error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// =====================================================================
// ===== AUTHENTICATION FUNCTIONS =====
// =====================================================================

/**
 * Authenticates a user and creates a new session token.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @param {string} username The username.
 * @param {string} password The password.
 * @return {object} The response object with token or error.
 */
function authenticateUser(ss, username, password) {
  try {
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const usersData = usersSheet.getDataRange().getValues(); // Includes header

    // 1. Find user by username (case-insensitive search starting from row 2)
    const userRowIndex = usersData.findIndex((row, index) => 
      index > 0 && row[0].toString().toLowerCase() === username.toLowerCase()
    );

    if (userRowIndex < 0) {
      return { success: false, error: "Invalid username or password" };
    }
    
    const user = usersData[userRowIndex];

    // 2. Verify password
    if (user[1].toString() !== password.toString()) {
      return { success: false, error: "Invalid username or password" };
    }

    // 3. Check user status
    if (user[2].toString().toLowerCase() !== "active") {
      return { success: false, error: "Account is inactive" };
    }

    // --- Cleanup Existing Sessions for this User ---
    const sessionsData = sessionsSheet.getDataRange().getValues();
    
    // Iterate backwards to avoid index shift when deleting
    for (let i = sessionsData.length - 1; i > 0; i--) {
        if (sessionsData[i][0].toString().toLowerCase() === username.toLowerCase()) {
            // Row index in the sheet is i + 1 (since 0-based array and 1-based sheet index)
            sessionsSheet.deleteRow(i + 1); 
        }
    }
    // Note: cleanupExpiredSessions should ideally run periodically, but 
    // we focus on removing stale sessions for the logging-in user here.
    
    // --- Create New Session ---
    const token = generateToken();
    const expiry = getExpiryDate();
    const lastRow = sessionsSheet.getLastRow();

    sessionsSheet.getRange(lastRow + 1, 1, 1, 4).setValues([
      [username, token, expiry, new Date()]
    ]);

    return {
      success: true,
      token: token,
      message: "Login successful",
      user: {
        username: user[0]
      }
    };
  } catch (error) {
    Logger.log("Authentication Error: " + error.message);
    return { success: false, error: "Authentication failed due to server error." };
  }
}

/**
 * Validates a session token for expiry and existence.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @param {string} token The session token.
 * @return {object} The validation result.
 */
function validateToken(ss, token) {
  try {
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const sessionsData = sessionsSheet.getDataRange().getValues();

    // Find session by token
    const sessionIndex = sessionsData.findIndex((row, index) => index > 0 && row[1] === token);

    if (sessionIndex < 0) {
      return { valid: false, error: "Invalid token" };
    }
    
    const session = sessionsData[sessionIndex];
    const expiry = new Date(session[2]);

    // Check expiry
    if (new Date() > expiry) {
      // Delete expired session
      sessionsSheet.deleteRow(sessionIndex + 1);
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, username: session[0], message: "Token is valid" };
  } catch (error) {
    Logger.log("Token Validation Error: " + error.message);
    return { valid: false, error: "Validation failed due to server error." };
  }
}

/**
 * Deletes a session token, effectively logging the user out.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @param {string} token The session token to invalidate.
 * @return {object} Success response.
 */
function logoutUser(ss, token) {
  try {
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const sessionsData = sessionsSheet.getDataRange().getValues();

    // Find session index by token
    const sessionIndex = sessionsData.findIndex((row, index) => index > 0 && row[1] === token);

    if (sessionIndex > -1) {
      // Row index in the sheet is index + 1
      sessionsSheet.deleteRow(sessionIndex + 1);
      return { success: true, message: "Logged out successfully" };
    }

    return { success: true, message: "Session already inactive." };
  } catch (error) {
    Logger.log("Logout Error: " + error.message);
    return { success: false, error: "Logout failed due to server error." };
  }
}

/**
 * Retrieves non-sensitive user information based on a valid token.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @param {string} token The session token.
 * @return {object} The user info or error.
 */
function getUserInfo(ss, token) {
  try {
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const usersSheet = ss.getSheetByName(USERS_SHEET);

    // 1. Validate token and get username
    const validationResult = validateToken(ss, token);
    if (!validationResult.valid) {
        return { success: false, error: validationResult.error };
    }
    const username = validationResult.username;

    // 2. Get user info
    const usersData = usersSheet.getDataRange().getValues();
    const user = usersData.find((row, index) => index > 0 && row[0] === username);

    if (!user) {
      return { success: false, error: "User not found" };
    }

    return {
      success: true,
      user: {
        username: user[0],
        status: user[2]
      }
    };
  } catch (error) {
    Logger.log("Get User Info Error: " + error.message);
    return { success: false, error: "Failed to retrieve user information." };
  }
}


// =====================================================================
// ===== MAINTENANCE & TESTING FUNCTIONS (Optional) =====
// =====================================================================

/**
 * Cleans up all expired sessions in the Sessions sheet.
 * This can be set up as a time-driven trigger.
 */
function cleanupExpiredSessions() {
  try {
    // We use the active spreadsheet here, assuming this function runs 
    // manually or via a trigger attached to the script/sheet.
    const ss = SpreadsheetApp.getActiveSpreadsheet(); 
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const data = sessionsSheet.getDataRange().getValues();
    let deleted = 0;

    // Iterate backwards to avoid row index issues when deleting
    for (let i = data.length - 1; i > 0; i--) {
      const expiry = new Date(data[i][2]);
      if (new Date() > expiry) {
        // Row index in the sheet is i + 1
        sessionsSheet.deleteRow(i + 1);
        deleted++;
      }
    }

    Logger.log("Deleted " + deleted + " expired sessions.");
    return { success: true, deleted: deleted };
  } catch (error) {
    Logger.log("Cleanup Error: " + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Simple test function to view all users for debugging.
 */
function viewAllUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(USERS_SHEET);
  const data = usersSheet.getDataRange().getValues();
  Logger.log("All Users:", data);
  return data;
}

/**
 * Simple test function to view active sessions for debugging.
 */
function viewActiveSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
  const data = sessionsSheet.getDataRange().getValues();
  Logger.log("Active Sessions:", data);
  return data;
}