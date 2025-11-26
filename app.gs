// ============================================
// GOOGLE APPS SCRIPT - MODERATED SELECTION SYSTEM (NO LIMITS)
//
// This system implements a two-step process:
// 1. doPost saves submissions to a Pending sheet and the LGA-specific sheet. (Sends Registration Confirmation)
// 2. An Admin manually marks registrants as 'APPROVED' in the LGA sheets.
// 3. processLGASelection() is run manually to move approved records to the Verified sheet and send the final attendance code.
// ============================================

// Configuration - UPDATE THESE VALUES
const SPREADSHEET_ID = '1jP6u2FTbTxB6-6tNLRnxWz-81BwA7KVTMeozhOSoZRU'; // YOUR SPREADSHEET ID
const PENDING_SHEET_NAME = 'Pending Submissions';
const VERIFIED_SHEET_NAME = 'Final Verified Attendees';
// NOTE: SELECTION_LIMIT_PER_LGA has been removed. Approval is now purely based on manual selection.

// Map LGA values from the form to the actual Google Sheet names
// NOTE: Make sure the keys (e.g., 'Ahoada East') exactly match the input form value.
// You MUST run setupSheets() after defining all your LGAs here.
const LGA_SHEET_MAP = {
    "Khana": "LGA_Khana",
    "Gokana": "LGA_Gokana",
    "Tai": "LGA_Tai",
    "Eleme": "LGA_Eleme",
};


// ============================================
// HANDLE POST REQUEST (Form Submission)
// ============================================
function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Invalid request format.' })).setMimeType(ContentService.MimeType.JSON);
        }

        const data = JSON.parse(e.postData.contents);
        const { fullName, email, phoneNumber, community, lgaOrigin, ageRange, occupation, message: reason, attendanceMode } = data;
        const timestamp = new Date();

        // 1. Basic Validation Checks
        if (!fullName || !email || !phoneNumber || !community || !lgaOrigin || !ageRange || !occupation || !reason || !attendanceMode) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'All fields are required for submission.' })).setMimeType(ContentService.MimeType.JSON);
        }
        if (!isValidEmail(email)) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Invalid email address.' })).setMimeType(ContentService.MimeType.JSON);
        }

        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

        // 2. Initial Duplicate Check (Check in Pending and Final Verified)
        // Note: isEmailRegistered uses a different column index based on the sheet structure
        if (isEmailRegistered(email, ss, PENDING_SHEET_NAME) || isEmailRegistered(email, ss, VERIFIED_SHEET_NAME)) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'This email is already registered.' })).setMimeType(ContentService.MimeType.JSON);
        }

        // 3. Process New Submission to Pending & LGA-Specific Sheet
        const pendingSheet = ss.getSheetByName(PENDING_SHEET_NAME);
        const lgaSheetName = LGA_SHEET_MAP[lgaOrigin];
        const lgaSheet = lgaSheetName ? ss.getSheetByName(lgaSheetName) : null;
        
        if (!pendingSheet || !lgaSheet) {
            Logger.log(`Missing sheet for LGA: ${lgaOrigin}. Check LGA_SHEET_MAP.`);
            return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Internal error: Required spreadsheet setup is incomplete. Run setupSheets().' })).setMimeType(ContentService.MimeType.JSON);
        }

        const rowData = [
            timestamp,         // Col A - Timestamp (Index 0)
            fullName,          // Col B (Index 1)
            email,             // Col C (Index 2)
            phoneNumber,       // Col D (Index 3)
            community,         // Col E (Index 4)
            lgaOrigin,         // Col F (Index 5)
            ageRange,          // Col G (Index 6)
            occupation,        // Col H (Index 7)
            reason,            // Col I (Index 8)
            attendanceMode,    // Col J (Index 9)
            "Pending Review"   // Col K - Status (Index 10)
        ];

        pendingSheet.appendRow(rowData); // Save to main pending sheet
        
        // Add to LGA Sheet with the required 'Approval Status' column (Col L, Index 11)
        lgaSheet.appendRow([...rowData, '']); // The last element is the empty approval status column

        // Send confirmation email (NO CODE YET)
        sendConfirmationEmail(email, fullName);

        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            message: 'Registration successful! You will be notified via email if you are selected to attend.'
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        Logger.log('Error in doPost: ' + error.toString());
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'An internal server error occurred.' })).setMimeType(ContentService.MimeType.JSON);
    }
}

// ============================================
// MODERATED SELECTION & EMAIL FUNCTION (MANUALLY RUN THIS)
// ============================================
/**
 * Processes the selection for all LGAs, moves approved to Verified, and sends the final code email.
 * This runs against all manually marked 'APPROVED' records without any limitation.
 */
function processLGASelection() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
    const results = {};

    if (!verifiedSheet) {
        Logger.log(`The sheet '${VERIFIED_SHEET_NAME}' was not found. Please run setupSheets().`);
        return;
    }

    for (const lgaOrigin in LGA_SHEET_MAP) {
        const lgaSheetName = LGA_SHEET_MAP[lgaOrigin];
        const lgaSheet = ss.getSheetByName(lgaSheetName);
        results[lgaOrigin] = { approved: 0, error: null };

        if (!lgaSheet) {
            results[lgaOrigin].error = 'LGA sheet not found.';
            continue;
        }

        try {
            // Get all data from the LGA sheet, including the Status and Approval Status columns
            const range = lgaSheet.getDataRange();
            const values = range.getValues();
            
            if (values.length <= 1) continue; // Only header row

            // Get the indices for the Status (K) and Approval Status (L) columns
            const statusColIndex = values[0].length - 2; // K (index 10)
            const approvalStatusColIndex = values[0].length - 1; // L (index 11)

            // Iterate over the rows, skipping the header
            for (let i = 1; i < values.length; i++) {
                const row = values[i];
                
                // --- FIX: Check both potential status columns for 'APPROVED' ---
                const statusK = row[statusColIndex] ? row[statusColIndex].toString().trim().toUpperCase() : '';
                const statusL = row[approvalStatusColIndex] ? row[approvalStatusColIndex].toString().trim().toUpperCase() : '';
                
                const isApproved = statusK === 'APPROVED' || statusK === 'APPROVE' || 
                                   statusL === 'APPROVED' || statusL === 'APPROVE';
                                   
                // Only process if manually approved and not yet moved
                if (isApproved) {
                    
                    const [timestamp, fullName, email, phoneNumber, community, lga, ageRange, occupation, reason, attendanceMode] = row;
                    
                    // --- FIX: Add validation check for email (addresses "Failed to send email: no recipient" error) ---
                    if (!email || !isValidEmail(email.toString())) {
                        Logger.log(`Skipping row ${i + 1} in ${lgaSheetName}: Invalid or missing email address: ${email}`);
                        // Mark the cell that triggered the approval as 'EMAIL ERROR' to prevent re-processing
                        const statusCell = statusL.startsWith('APPROVE') ? approvalStatusColIndex : statusColIndex;
                        lgaSheet.getRange(i + 1, statusCell + 1).setValue('EMAIL ERROR');
                        continue;
                    }
                    
                    // Prevent duplicate processing if somehow the user already ended up verified
                    if (isEmailRegistered(email.toString(), ss, VERIFIED_SHEET_NAME)) {
                        // Mark as processed/ignored in LGA sheet to avoid re-checking
                        lgaSheet.getRange(i + 1, approvalStatusColIndex + 1).setValue('PROCESSED (Already Verified)');
                        continue; 
                    }
                    
                    const uniqueCode = generateUniqueCode();
                    
                    // 1. Append to Final Verified Sheet (Column order adjusted to match Verified sheet setup)
                    verifiedSheet.appendRow([
                        uniqueCode,           // Col A - 4-Digit Code
                        timestamp,            // Col B - Timestamp
                        fullName,             // Col C
                        email,                // Col D
                        phoneNumber,          // Col E
                        lga,                  // Col F (LGA of Origin)
                        community,            // Col G
                        ageRange,             // Col H
                        occupation,           // Col I
                        reason,               // Col J
                        attendanceMode,       // Col K
                        "Final Code Sent"     // Col L - Status
                    ]);

                    // 2. Send the Final Attendance Code Email
                    sendFinalCodeEmail(email.toString(), fullName.toString(), uniqueCode);

                    // 3. Mark as processed in the LGA sheet
                    // Determine which column was marked 'APPROVED' and update it
                    const statusCellToUpdate = statusL.startsWith('APPROVE') ? approvalStatusColIndex : statusColIndex;
                    lgaSheet.getRange(i + 1, statusCellToUpdate + 1).setValue('SENT: ' + uniqueCode);
                    
                    results[lgaOrigin].approved++;
                }
            }
        } catch (e) {
            Logger.log(`Error processing LGA ${lgaOrigin}: ${e.toString()}`);
            results[lgaOrigin].error = e.toString();
        }
    }
    
    // Log final summary
    Logger.log('Selection Process Complete. Summary: ' + JSON.stringify(results));
}

// ============================================
// HELPER FUNCTIONS 
// ============================================

/**
 * Checks if an email address already exists in a given sheet.
 * @param {string} email The email address to check.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss The spreadsheet object.
 * @param {string} sheetName The name of the sheet to check.
 * @returns {boolean} True if the email is found, false otherwise.
 */
function isEmailRegistered(email, ss, sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return false;

    // Email column index (Verified sheet is Col D (index 3), Pending/LGA is Col C (index 2))
    const emailColIndex = sheetName === VERIFIED_SHEET_NAME ? 4 : 3; 

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;

    // Get the range of the Email column from row 2 to the last row
    const emailColumnValues = sheet.getRange(2, emailColIndex, lastRow - 1, 1).getValues();

    const normalizedEmail = email.toLowerCase().trim();

    for (let i = 0; i < emailColumnValues.length; i++) {
        if (emailColumnValues[i][0].toString().toLowerCase().trim() === normalizedEmail) {
            return true;
        }
    }
    return false;
}

function isValidEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function generateUniqueCode() {
    // Generates a 4-digit code (1000 to 9999)
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ============================================
// EMAIL FUNCTIONS
// ============================================

/**
 * Sends a simple registration confirmation email (no code).
 */
/**
 * Sends a professional HTML confirmation email with improved design.
 * Replace your current sendConfirmationEmail function with this version.
 */
function sendConfirmationEmail(email, fullName) {
    const subject = '✅ Registration Received - Your Summit Application is Under Review';
    
    const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              margin: 0; 
              padding: 0; 
              background-color: #f4f4f4; 
            }
            .container { 
              max-width: 600px; 
              margin: 20px auto; 
              background: white; 
              border-radius: 12px; 
              overflow: hidden; 
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
            }
            .header { 
              background: linear-gradient(135deg, #821917 0%, #cb7511 100%); 
              color: white; 
              padding: 40px 30px; 
              text-align: center; 
            }
            .logo-container { 
              background: white; 
              display: inline-block; 
              padding: 15px 25px; 
              border-radius: 8px; 
              margin-bottom: 20px; 
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); 
            }
            .logo { 
              max-width: 140px; 
              height: auto; 
              display: block; 
            }
            .header h1 { 
              margin: 10px 0 0 0; 
              font-size: 28px; 
              font-weight: 600; 
            }
            .subheader {
              font-size: 16px;
              font-weight: 300;
              margin-top: 10px;
              opacity: 0.95;
            }
            .content { 
              background: #ffffff; 
              padding: 40px 30px; 
            }
            .content p { 
              margin: 15px 0; 
              font-size: 16px; 
              line-height: 1.8;
            }
            .greeting {
              font-size: 18px;
              font-weight: 600;
              color: #821917;
              margin-bottom: 20px;
            }
            .status-box { 
              background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); 
              border-left: 5px solid #ff9800; 
              padding: 20px; 
              margin: 25px 0; 
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(255, 152, 0, 0.1);
            }
            .status-box strong {
              color: #e65100;
              font-size: 17px;
            }
            .status-box p {
              margin: 10px 0 0 0;
              color: #555;
            }
            .timeline {
              background: #f8f9fa;
              border: 1px solid #e9ecef;
              padding: 20px;
              margin: 25px 0;
              border-radius: 8px;
            }
            .timeline-title {
              font-weight: 600;
              color: #821917;
              margin-bottom: 15px;
              font-size: 16px;
            }
            .timeline-step {
              display: flex;
              margin: 12px 0;
              align-items: flex-start;
            }
            .step-number {
              background: #821917;
              color: white;
              width: 30px;
              height: 30px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              margin-right: 15px;
              flex-shrink: 0;
            }
            .step-content {
              flex: 1;
            }
            .step-content p {
              margin: 0;
              color: #555;
              font-size: 15px;
            }
            .highlight { 
              color: #821917; 
              font-weight: 600; 
            }
            .note-box {
              background: #e7f3ff;
              border-left: 4px solid #2196F3;
              padding: 15px 20px;
              margin: 20px 0;
              border-radius: 4px;
              font-size: 14px;
              color: #0d47a1;
            }
            .button-container {
              text-align: center;
              margin: 30px 0;
            }
            .button {
              background: linear-gradient(135deg, #821917 0%, #cb7511 100%);
              color: white;
              text-decoration: none;
              padding: 14px 35px;
              border-radius: 6px;
              display: inline-block;
              font-weight: 600;
              transition: transform 0.2s;
            }
            .button:hover {
              transform: scale(1.05);
            }
            .footer { 
              background: #f8f9fa; 
              text-align: center; 
              padding: 30px 20px; 
              color: #999; 
              font-size: 13px; 
              border-top: 1px solid #e9ecef; 
            }
            .footer-links {
              margin-top: 10px;
            }
            .footer-links a {
              color: #821917;
              text-decoration: none;
              margin: 0 10px;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <!-- Header Section -->
            <div class="header">
              <div class="logo-container">
                <img src="https://drive.google.com/uc?export=view&id=1xLhqnGlUwLM-Jb_5mMNgT2NNyywraNmb" alt="Event Logo" class="logo">
              </div>
              <h1>Registration Received! 📋</h1>
              <p class="subheader">Your application is being reviewed</p>
            </div>

            <!-- Main Content -->
            <div class="content">
              <p class="greeting">Hello ${fullName},</p>
              
              <p>Thank you for submitting your registration for the summit! We're excited that you're interested in attending this important event.</p>

              <!-- Status Box -->
              <div class="status-box">
                <strong>✓ Your submission has been successfully received</strong>
                <p>We have recorded all your information and your application is now under review by our selection committee.</p>
              </div>

              <!-- What Happens Next -->
              <div class="timeline">
                <div class="timeline-title">What Happens Next?</div>
                
                <div class="timeline-step">
                  <div class="step-number">1</div>
                  <div class="step-content">
                    <p><strong>Review Phase</strong><br>Your application is being carefully reviewed by our team.</p>
                  </div>
                </div>

                <div class="timeline-step">
                  <div class="step-number">2</div>
                  <div class="step-content">
                    <p><strong>Selection Decision</strong><br>We will notify selected attendees by email with their unique attendance code.</p>
                  </div>
                </div>

                <div class="timeline-step">
                  <div class="step-number">3</div>
                  <div class="step-content">
                    <p><strong>Event Entry</strong><br>Use your 4-digit code at check-in to gain access to the summit.</p>
                  </div>
                </div>
              </div>

              <!-- Important Note -->
              <div class="note-box">
                <strong>📧 Important:</strong> If you are selected to attend, you will receive a <span class="highlight">separate email</span> containing your unique 4-digit <span class="highlight">Attendance Code</span>. Keep this email safe as you'll need the code at the event entrance.
              </div>

              <!-- Closing Message -->
              <p>We appreciate your interest and will be in touch soon with our final selection decisions. If you have any questions, please don't hesitate to reach out.</p>

              <p>Thank you again, and we hope to see you at the summit!</p>

              <p style="margin-top: 30px;">
                <strong>Best regards,</strong><br>
                The Event Organization Team
              </p>
            </div>

            <!-- Footer -->
            <div class="footer">
              <p>This is an automated confirmation message. Please do not reply to this email.</p>
              <div class="footer-links">
                <a href="#">Privacy Policy</a> | <a href="#">Contact Us</a>
              </div>
            </div>
          </div>
        </body>
        </html>
    `;

    try {
        GmailApp.sendEmail(email, subject, "", {
            htmlBody: htmlBody
        });
        Logger.log(`Confirmation email sent successfully to ${email}`);
    } catch (e) {
        Logger.log(`ERROR: Failed to send confirmation email to ${email}. Error: ${e.toString()}`);
    }
}

/**
 * Sends the unique 4-digit code using the GmailApp service.
 * This is the final attendance acceptance email.
 */
function sendFinalCodeEmail(email, fullName, code) {
    const subject = '🎉 Congratulations! Your Event Attendance Code is Here! 🎉';
    const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #821917 0%, #cb7511 100%); color: white; padding: 40px 30px; text-align: center; }
            .logo-container { background: white; display: inline-block; padding: 15px 25px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); }
            .logo { max-width: 140px; height: auto; display: block; }
            .header h1 { margin: 10px 0 0 0; font-size: 28px; font-weight: 600; }
            .content { background: #ffffff; padding: 40px 30px; }
            .content p { margin: 15px 0; font-size: 16px; }
            .code-box { background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border: 3px solid #821917; padding: 30px 20px; text-align: center; margin: 30px 0; border-radius: 12px; box-shadow: 0 2px 8px rgba(130, 25, 23, 0.1); }
            .code-label { font-size: 14px; color: #666; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
            .code { font-size: 48px; font-weight: bold; color: #821917; letter-spacing: 12px; font-family: 'Courier New', monospace; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1); }
            .highlight { color: #821917; font-weight: 600; }
            .info-box { background: #e6ffed; border-left: 4px solid #28a745; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
            .footer { background: #f8f9fa; text-align: center; padding: 30px 20px; color: #666; font-size: 13px; border-top: 1px solid #e9ecef; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo-container">
                <img src="https://drive.google.com/uc?export=view&id=1xLhqnGlUwLM-Jb_5mMNgT2NNyywraNmb" alt="Logo" class="logo">
              </div>
              <h1>Attendance Approved!</h1>
            </div>
            <div class="content">
              <p>Dear <span class="highlight">${fullName}</span>,</p>
              <p>Great news! We are pleased to inform you that your registration has been **APPROVED** and you have been selected to attend the summit!</p>
              
              <div class="info-box">
                <strong>✅ CONGRATULATIONS! You have been selected to attend. ✅</strong>
              </div>
              
              <p>Here is your unique **Attendance Code** required for entry:</p>
              
              <div class="code-box">
                <div class="code-label">Your Official Attendance Code</div>
                <div class="code">${code}</div>
              </div>
              
              <p>Please save this code! You **MUST** present this unique 4-digit code at the event check-in to gain entry. This code is your official ticket.</p>
              <p style="margin-top: 30px;">We look forward to a successful summit with you!</p>
            </div>
            <div class="footer">
              <p>This is your official confirmation. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
    `;

    try {
        GmailApp.sendEmail(email, subject, "", {
            htmlBody: htmlBody
        });
    } catch (e) {
        Logger.log(`FATAL ERROR: Failed to send final code email to ${email}. Check sheet data integrity. Error: ${e.toString()}`);
        throw e; // Re-throw to halt the script if we can't send the final code
    }
}

// ============================================
// SETUP FUNCTION (Run this once to create sheets)
// ============================================
function setupSheets() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // 1. Create Pending Sheet (All raw submissions)
    let pendingSheet = ss.getSheetByName(PENDING_SHEET_NAME);
    const pendingHeader = ['Timestamp', 'Full Name', 'Email', 'Phone Number', 'Community', 'LGA of Origin', 'Age Range', 'Occupation/Business Interest', 'Why Attend Summit', 'Mode of Attendance', 'Status'];
    if (!pendingSheet) {
        pendingSheet = ss.insertSheet(PENDING_SHEET_NAME);
        pendingSheet.appendRow(pendingHeader);
        pendingSheet.getRange(1, 1, 1, pendingHeader.length).setFontWeight('bold').setBackground('#ffc107').setFontColor('black');
    }

    // 2. Create Final Verified Sheet (Only approved attendees who received codes)
    let verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
    const verifiedHeader = ['4-Digit Code', 'Timestamp', 'Full Name', 'Email', 'Phone Number', 'LGA of Origin', 'Community', 'Age Range', 'Occupation/Business Interest', 'Why Attend Summit', 'Mode of Attendance', 'Status'];
    if (!verifiedSheet) {
        verifiedSheet = ss.insertSheet(VERIFIED_SHEET_NAME);
        verifiedSheet.appendRow(verifiedHeader);
        verifiedSheet.getRange('A1:L1').setFontWeight('bold').setBackground('#28a745').setFontColor('white');
    }

    // 3. Create LGA Specific Sheets (For manual selection)
    // NOTE: The header for LGA sheets includes the extra 'Approval Status' column at the end.
    const lgaHeader = [...pendingHeader, 'Approval Status (Type: APPROVE or APPROVED)'];
    const sheetNamesToCreate = new Set(Object.values(LGA_SHEET_MAP));

    sheetNamesToCreate.forEach(sheetName => {
        let lgaSheet = ss.getSheetByName(sheetName);
        if (!lgaSheet) {
            lgaSheet = ss.insertSheet(sheetName);
            lgaSheet.appendRow(lgaHeader);
            lgaSheet.getRange(1, 1, 1, lgaHeader.length).setFontWeight('bold').setBackground('#007bff').setFontColor('white');
            lgaSheet.setColumnWidth(lgaHeader.length, 150); // Widen the Approval Status column
        }
    });

    Logger.log('All required sheets setup complete!');
}