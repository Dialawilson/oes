// ===== CONFIGURATION =====
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // Replace with your sheet ID
const USERS_SHEET = "Users";
const SESSIONS_SHEET = "Sessions";

// ===== SETUP FUNCTION =====
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Create Users sheet
  let usersSheet = ss.getSheetByName(USERS_SHEET);
  if (!usersSheet) {
    usersSheet = ss.insertSheet(USERS_SHEET, 0);
  } else {
    usersSheet.clear();
  }
  
  // Set up Users table headers
  usersSheet.getRange("A1:C1").setValues([
    ["Username", "Password", "Status"]
  ]);
  
  // Add sample users
  const sampleData = [
    ["admin", "admin123", "active"],
    ["user1", "password123", "active"]
  ];
  usersSheet.getRange("A2:C3").setValues(sampleData);
  
  // Format Users sheet
  usersSheet.setColumnWidths([25, 25, 15]);
  usersSheet.getRange("A1:C1").setFontWeight("bold").setBackground("#4285F4").setFontColor("white");
  usersSheet.getRange("A1:C1").setAlignment("center", "center");
  
  // Create Sessions sheet
  let sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet(SESSIONS_SHEET, 1);
  } else {
    sessionsSheet.clear();
  }
  
  // Set up Sessions table headers
  sessionsSheet.getRange("A1:D1").setValues([
    ["Username", "Token", "Expiry", "Created Date"]
  ]);
  
  sessionsSheet.setColumnWidths([25, 50, 20, 20]);
  sessionsSheet.getRange("A1:D1").setFontWeight("bold").setBackground("#34A853").setFontColor("white");
  sessionsSheet.getRange("A1:D1").setAlignment("center", "center");
  
  // Protect sheets
  protectSheet(usersSheet);
  protectSheet(sessionsSheet);
  
  SpreadsheetApp.getUi().alert("✓ Database setup complete!\n\nUsers sheet created. Add your usernames and passwords manually.\n\nSpreadsheet ID: " + SPREADSHEET_ID);
}

function protectSheet(sheet) {
  try {
    const protection = sheet.protect();
    protection.removeEditors(protection.getEditors());
    protection.addEditor(Session.getEffectiveUser());
  } catch(e) {
    Logger.log("Sheet protection note: " + e.message);
  }
}

// ===== UTILITY FUNCTIONS =====
function generateToken() {
  return Utilities.getUuid();
}

function getExpiryDate(hoursFromNow = 24) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hoursFromNow);
  return expiry;
}

// ===== MAIN API HANDLER =====
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    let response = {};

    if (action === "login") {
      response = authenticateUser(data.username, data.password);
    } else if (action === "validateToken") {
      response = validateToken(data.token);
    } else if (action === "logout") {
      response = logoutUser(data.token);
    } else if (action === "getUserInfo") {
      response = getUserInfo(data.token);
    } else {
      response = { success: false, error: "Invalid action" };
    }

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Server error: " + error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== AUTHENTICATION FUNCTIONS =====
function authenticateUser(username, password) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    const data = usersSheet.getDataRange().getValues();

    // Find user by username (case-insensitive)
    const user = data.find((row, index) => index > 0 && row[0].toString().toLowerCase() === username.toLowerCase());

    if (!user) {
      return { success: false, error: "Invalid username or password" };
    }

    // Verify password
    if (user[1].toString() !== password.toString()) {
      return { success: false, error: "Invalid username or password" };
    }

    // Check user status
    if (user[2].toString().toLowerCase() !== "active") {
      return { success: false, error: "Account is inactive" };
    }

    // Create session
    const token = generateToken();
    const expiry = getExpiryDate(24);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
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
    return { success: false, error: error.message };
  }
}

function validateToken(token) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const data = sessionsSheet.getDataRange().getValues();

    // Find session by token
    const session = data.find((row, index) => index > 0 && row[1] === token);

    if (!session) {
      return { valid: false, error: "Invalid token" };
    }

    // Check expiry
    const expiry = new Date(session[2]);
    if (new Date() > expiry) {
      // Delete expired session
      const rowIndex = data.indexOf(session) + 1;
      sessionsSheet.deleteRow(rowIndex);
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, username: session[0], message: "Token is valid" };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function logoutUser(token) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const data = sessionsSheet.getDataRange().getValues();

    // Find and delete session by token
    const sessionIndex = data.findIndex((row, index) => index > 0 && row[1] === token);

    if (sessionIndex > -1) {
      sessionsSheet.deleteRow(sessionIndex + 1);
    }

    return { success: true, message: "Logged out successfully" };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getUserInfo(token) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const usersSheet = ss.getSheetByName(USERS_SHEET);

    const sessionsData = sessionsSheet.getDataRange().getValues();
    const usersData = usersSheet.getDataRange().getValues();

    // Find session by token
    const session = sessionsData.find((row, index) => index > 0 && row[1] === token);

    if (!session) {
      return { success: false, error: "Invalid token" };
    }

    // Get user info
    const user = usersData.find((row, index) => index > 0 && row[0] === session[0]);

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
    return { success: false, error: error.message };
  }
}

// ===== TESTING FUNCTIONS =====
function testLogin() {
  const result = authenticateUser("admin", "admin123");
  Logger.log("Login test:", result);
  return result;
}

function viewAllUsers() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName(USERS_SHEET);
  const data = usersSheet.getDataRange().getValues();
  Logger.log("All Users:", data);
  return data;
}

function viewActiveSessions() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
  const data = sessionsSheet.getDataRange().getValues();
  Logger.log("Active Sessions:", data);
  return data;
}

function cleanupExpiredSessions() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sessionsSheet = ss.getSheetByName(SESSIONS_SHEET);
    const data = sessionsSheet.getDataRange().getValues();
    let deleted = 0;

    // Iterate backwards to avoid row index issues
    for (let i = data.length - 1; i > 0; i--) {
      const expiry = new Date(data[i][2]);
      if (new Date() > expiry) {
        sessionsSheet.deleteRow(i + 1);
        deleted++;
      }
    }

    Logger.log("Deleted " + deleted + " expired sessions");
    return { success: true, deleted: deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}