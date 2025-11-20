// ============================================
// GOOGLE APPS SCRIPT - EMAIL VERIFICATION SYSTEM (Simplified)
//
// NOTE: This version uses GmailApp for potentially higher email limits.
// ============================================

// Configuration - UPDATE THESE VALUES
const SPREADSHEET_ID = '14c8ihY1HoDyHNEYCRWijK_0j_fFnG5kivhitLxkQP3A'; // Get from URL of your Google Sheet
const VERIFIED_SHEET_NAME = 'Verified'; // Only using the Verified sheet based on current flow logic

// ============================================
// HANDLE POST REQUEST (Form Submission)
// ============================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'Invalid request format.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);
    const fullName = data.fullName;
    const email = data.email;
    const phoneNumber = data.phoneNumber;
    const community = data.community;
    const lgaOrigin = data.lgaOrigin;
    const ageRange = data.ageRange;
    const occupation = data.occupation;

    // ✅ FIX IMPLEMENTED: Use data.message as intended by the comment
    const reason = data.message; 

    const attendanceMode = data.attendanceMode;

    // 1. Basic Validation Checks (Updated to check all required fields)
    if (!fullName || !email || !phoneNumber || !community || !lgaOrigin || !ageRange || !occupation || !reason || !attendanceMode) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'All fields are required for submission.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (!isValidEmail(email)) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'Invalid email address.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 2. Duplicate Check: Check if email already exists in the Verified sheet
    if (isEmailRegistered(email, ss)) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'This email is already registered and a code has been sent previously.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Process New Submission (Saves directly to Verified sheet and sends code)
    const timestamp = new Date();
    const uniqueCode = generateUniqueCode(); // Generate the code immediately

    const verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
    
    // Check if sheet exists before trying to append
    if (!verifiedSheet) {
        Logger.log(`Sheet '${VERIFIED_SHEET_NAME}' not found.`); 
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          message: `The required sheet '${VERIFIED_SHEET_NAME}' was not found. Please run setupSheets() first.`
        })).setMimeType(ContentService.MimeType.JSON);
    }

    // Save the submission with all new fields. Ensure the order matches the headers in setupSheets.
    verifiedSheet.appendRow([
      timestamp,
      fullName,
      email,
      phoneNumber,
      community,
      lgaOrigin,
      ageRange,
      occupation,
      reason,
      attendanceMode,
      uniqueCode,
      "Code Sent"
    ]);

    // Send the code email directly
    sendCodeEmail(email, fullName, uniqueCode);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Submission successful, unique code sent to your email.'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    // Log the actual error for debugging
    Logger.log('Error in doPost: ' + error.toString()); 
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'An internal server error occurred.'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// HELPER FUNCTIONS 
// ============================================

/**
 * Checks if an email address already exists in the VERIFIED_SHEET_NAME.
 * @param {string} email The email address to check.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @returns {boolean} True if the email is found, false otherwise.
 */
function isEmailRegistered(email, ss) {
  const verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
  if (!verifiedSheet) {
    // ✅ SYNTAX FIX IMPLEMENTED: Changed to template literal using backticks (`)
    Logger.log(`Sheet '${VERIFIED_SHEET_NAME}' not found.`); 
    return false;
  }

  // Email is in Column C (index 2)
  const lastRow = verifiedSheet.getLastRow();

  if (lastRow <= 1) {
    return false;
  }

  // Get the range of the Email column (C) from row 2 to the last row
  const emailColumnValues = verifiedSheet.getRange(2, 3, lastRow - 1, 1).getValues();

  const normalizedEmail = email.toLowerCase().trim();

  for (let i = 0; i < emailColumnValues.length; i++) {
    if (emailColumnValues[i][0].toString().toLowerCase().trim() === normalizedEmail) {
      return true;
    }
  }
  return false;
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function generateUniqueCode() {
  // Generates a 4-digit code (1000 to 9999)
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Sends the unique 4-digit code using the GmailApp service for higher quotas.
 */
function sendCodeEmail(email, fullName, code) {
  const subject = '🎉 Your Unique Verification Code';
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .code-box { background: white; border: 3px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
        .code { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Submission Code!</h1>
        </div>
        <div class="content">
          <p>Hi <strong>${fullName}</strong>,</p>
          <p>Thank you for submitting your information. Here is your unique 4-digit code:</p>
          <div class="code-box">
            <div class="code">${code}</div>
          </div>
          <p>Keep this code safe. You may need it for future reference.</p>
          <p>Thank you for completing your submission!</p>
        </div>
        <div class="footer">
          <p>This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  GmailApp.sendEmail(email, subject, "", {
    htmlBody: htmlBody
  });
}

// ============================================
// SETUP FUNCTION (Run this once to create sheets)
// ============================================
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // The original Pending sheet logic is removed as it's not used by doPost.
  // If you need an actual verification flow, this part needs to be re-added and doPost adjusted.
  let pendingSheet = ss.getSheetByName('Pending');
  if (pendingSheet) {
    Logger.log('Note: The "Pending" sheet exists but is currently unused by doPost.');
  }

  let verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
  if (!verifiedSheet) {
    verifiedSheet = ss.insertSheet(VERIFIED_SHEET_NAME);
    // === UPDATED HEADER ROW TO INCLUDE ALL NEW FIELDS ===
    verifiedSheet.appendRow([
      'Timestamp', 
      'Full Name', 
      'Email', 
      'Phone Number', // Column D
      'Community',    // Column E
      'LGA of Origin',// Column F
      'Age Range',    // Column G
      'Occupation/Business Interest', // Column H
      'Why Attend Summit', // Column I
      'Mode of Attendance', // Column J
      '4-Digit Code', // Column K
      'Status'        // Column L
    ]);
    verifiedSheet.getRange('A1:L1').setFontWeight('bold').setBackground('#28a745').setFontColor('white');
  }

  Logger.log('Sheets setup complete!');
}