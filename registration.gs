/**
 * Ogoni Summit Registration Backend – NO ID COLUMN VERSION
 * Uses Email + Timestamp as unique identifier
 * NOW: Updates Pending status to APPROVED, prevents reapproval, supports stats
 */

const SPREADSHEET_ID = '1jP6u2FTbTxB6-6tNLRnxWz-81BwA7KVTMeozhOSoZRU';
const PENDING_SHEET_NAME = 'Pending Submissions';
const VERIFIED_SHEET_NAME = 'Final Verified Attendees';

const LGA_SHEET_MAP = {
    "Khana": "LGA_Khana",
    "Gokana": "LGA_Gokana",
    "Tai": "LGA_Tai",
    "Eleme": "LGA_Eleme",
};

// ========================================
// SETUP SHEETS – Run this ONCE after deploying
// ========================================
function setupSheets() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Pending Submissions
    let sheet = ss.getSheetByName(PENDING_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(PENDING_SHEET_NAME);
    sheet.clear();
    const pendingHeader = ['Timestamp', 'Full Name', 'Email', 'Phone Number', 'Community', 'LGA of Origin', 'Age Range', 'Occupation/Business Interest', 'Why Attend Summit', 'Mode of Attendance', 'Status'];
    sheet.appendRow(pendingHeader);
    sheet.getRange(1, 1, 1, pendingHeader.length)
         .setFontWeight('bold')
         .setBackground('#ffc107')
         .setFontColor('black');

    // Final Verified Attendees
    sheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(VERIFIED_SHEET_NAME);
    sheet.clear();
    const verifiedHeader = ['4-Digit Code', 'Timestamp', 'Full Name', 'Email', 'Phone Number', 'LGA of Origin', 'Community', 'Age Range', 'Occupation/Business Interest', 'Why Attend Summit', 'Mode of Attendance', 'Status'];
    sheet.appendRow(verifiedHeader);
    sheet.getRange(1, 1, 1, verifiedHeader.length)
         .setFontWeight('bold')
         .setBackground('#28a745')
         .setFontColor('white');

    // LGA Sheets
    const lgaHeader = ['Timestamp', 'Full Name', 'Email', 'Phone Number', 'Community', 'LGA of Origin', 'Age Range', 'Occupation/Business Interest', 'Why Attend Summit', 'Mode of Attendance', 'Status', 'Approval Status'];
    Object.values(LGA_SHEET_MAP).forEach(name => {
        sheet = ss.getSheetByName(name);
        if (!sheet) sheet = ss.insertSheet(name);
        sheet.clear();
        sheet.appendRow(lgaHeader);
        sheet.getRange(1, 1, 1, lgaHeader.length)
             .setFontWeight('bold')
             .setBackground('#007bff')
             .setFontColor('white');
    });

    Logger.log('All sheets recreated successfully WITHOUT ID column');
}

// ========================================
// MAIN HANDLERS
// ========================================
function doGet(e) {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const type = e.parameter.type || 'pending';
        const lgaName = e.parameter.lga;

        let data = [];
        let sheet;

        switch (type) {
            case 'pending':
                sheet = ss.getSheetByName(PENDING_SHEET_NAME);
                break;
            case 'verified':
                sheet = ss.getSheetByName(VERIFIED_SHEET_NAME);
                break;
            case 'lga':
                if (!lgaName || !LGA_SHEET_MAP[lgaName]) {
                    return createErrorResponse('Invalid or missing LGA', 400);
                }
                sheet = ss.getSheetByName(LGA_SHEET_MAP[lgaName]);
                break;
            case 'stats':
                // New: Return statistics per LGA
                return createJsonResponse(getLGAStats(ss));
            default:
                return createErrorResponse('Invalid type', 400);
        }

        if (sheet && sheet.getLastRow() > 0) {
            data = sheet.getDataRange().getValues();
        }

        return createJsonResponse({
            type,
            records: formatSheetData(data)
        });

    } catch (err) {
        return createErrorResponse('Fetch failed: ' + err.message, 500);
    }
}

function doPost(e) {
    try {
        const params = e.parameter;
        const action = params.action || 'register';
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

        if (action === 'register') return handleRegistration(ss, params);
        if (action === 'approve')   return handleApproval(ss, params);

        return createErrorResponse('Invalid action', 400);
    } catch (err) {
        return createErrorResponse('Server error: ' + err.message, 500);
    }
}

// ========================================
// REGISTRATION
// ========================================
function handleRegistration(ss, params) {
    try {
        const { fullName, email, phoneNumber, community, lgaOrigin, ageRange, occupation, reason, attendanceMode } = params;

        // Validate required fields
        if (!fullName || !email || !phoneNumber || !community || !lgaOrigin || !ageRange || !occupation || !reason || !attendanceMode) {
            return createErrorResponse('All fields are required.', 400);
        }

        if (!isValidEmail(email)) {
            return createErrorResponse('Invalid email address.', 400);
        }

        // Prevent duplicate registration
        if (isEmailRegistered(email, ss, PENDING_SHEET_NAME) || isEmailRegistered(email, ss, VERIFIED_SHEET_NAME)) {
            return createErrorResponse('This email is already registered.', 409);
        }

        const lgaSheetName = LGA_SHEET_MAP[lgaOrigin];
        if (!lgaSheetName) {
            return createErrorResponse('Invalid LGA selected.', 400);
        }

        const pendingSheet = ss.getSheetByName(PENDING_SHEET_NAME);
        const lgaSheet     = ss.getSheetByName(lgaSheetName);

        const timestamp = new Date();

        const rowData = [
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
            'Pending Review'
        ];

        // Save to both sheets
        pendingSheet.appendRow(rowData);
        lgaSheet.appendRow([...rowData, '']); // + empty Approval Status

        sendConfirmationEmail(email, fullName);

        return createJsonResponse({
            status: 'success',
            message: 'Registration successful! Check your email.',
            timestamp: timestamp.toISOString()
        });

    } catch (err) {
        Logger.log('Registration error: ' + err);
        return createErrorResponse('Registration failed: ' + err.message, 500);
    }
}

// ========================================
// APPROVAL (Uses Email + Timestamp)
// NOW: Updates Pending Status & Prevents Reapproval
// ========================================
function handleApproval(ss, params) {
    try {
        const { attendanceCode, lga, email, timestamp: timestampIso } = params;

        if (!attendanceCode || !lga || !email || !timestampIso) {
            return createErrorResponse('Missing required fields: attendanceCode, lga, email, timestamp', 400);
        }

        const lgaSheetName = LGA_SHEET_MAP[lga];
        if (!lgaSheetName) return createErrorResponse('Invalid LGA', 400);

        const lgaSheet      = ss.getSheetByName(lgaSheetName);
        const pendingSheet  = ss.getSheetByName(PENDING_SHEET_NAME);
        const verifiedSheet = ss.getSheetByName(VERIFIED_SHEET_NAME);

        // Find record in LGA sheet
        const lgaData = lgaSheet.getDataRange().getValues();
        let lgaFoundRow = -1;
        let record = null;
        const targetTime = new Date(timestampIso).getTime();

        for (let i = 1; i < lgaData.length; i++) {
            const rowTime = new Date(lgaData[i][0]).getTime();
            const rowEmail = lgaData[i][2]?.toString().trim().toLowerCase();

            if (Math.abs(rowTime - targetTime) < 60000 && rowEmail === email.toLowerCase()) {
                lgaFoundRow = i + 1; // 1-based for Range
                record = lgaData[i];
                break;
            }
        }

        if (!record) return createErrorResponse('Record not found in LGA sheet', 404);

        // Check if already approved in this LGA record
        const approvalStatus = record[11]?.toString().trim();
        if (approvalStatus && approvalStatus.toUpperCase().includes('APPROVED')) {
            return createErrorResponse('This candidate has already been approved', 409);
        }

        // Check if already verified
        if (isEmailRegistered(email, ss, VERIFIED_SHEET_NAME)) {
            return createErrorResponse('This email is already verified', 409);
        }

        // Remove from Pending sheet (delete the row)
        const pendingData = pendingSheet.getDataRange().getValues();
        for (let i = 1; i < pendingData.length; i++) {
            const rowTime = new Date(pendingData[i][0]).getTime();
            const rowEmail = pendingData[i][2]?.toString().trim().toLowerCase();

            if (Math.abs(rowTime - targetTime) < 60000 && rowEmail === email.toLowerCase()) {
                pendingSheet.deleteRow(i + 1); // Delete the row
                break;
            }
        }

        // Add to Verified sheet
        const verifiedRow = [
            attendanceCode,
            record[0], // Timestamp
            record[1], // Full Name
            record[2], // Email
            record[3], // Phone
            record[5], // LGA
            record[4], // Community
            record[6], // Age Range
            record[7], // Occupation
            record[8], // Reason
            record[9], // Mode
            'Final Code Sent'
        ];
        verifiedSheet.appendRow(verifiedRow);

        // Update Status column (column 11) and Approval Status column (column 12) in LGA sheet
        lgaSheet.getRange(lgaFoundRow, 11).setValue('Approved'); // Column 11 = Status
        lgaSheet.getRange(lgaFoundRow, 12).setValue('APPROVED - ' + attendanceCode); // Column 12 = Approval Status

        // Send email
        sendFinalCodeEmail(email, record[1], attendanceCode);

        return createJsonResponse({ 
            status: 'success', 
            message: 'Approved! Status updated in Pending sheet.' 
        });

    } catch (err) {
        Logger.log('Approval error: ' + err);
        return createErrorResponse('Approval failed: ' + err.message, 500);
    }
}

// ========================================
// STATS – Count Verified & Pending per LGA
// ========================================
function getLGAStats(ss) {
    const stats = {};

    Object.keys(LGA_SHEET_MAP).forEach(lgaName => {
        const sheetName = LGA_SHEET_MAP[lgaName];
        const sheet = ss.getSheetByName(sheetName);
        
        if (!sheet || sheet.getLastRow() <= 1) {
            stats[lgaName] = { pending: 0, approved: 0, total: 0 };
            return;
        }

        const data = sheet.getDataRange().getValues();
        let pending = 0, approved = 0;

        for (let i = 1; i < data.length; i++) {
            const approvalStatus = data[i][11]?.toString().trim().toUpperCase() || '';
            if (approvalStatus.includes('APPROVED')) {
                approved++;
            } else {
                pending++;
            }
        }

        stats[lgaName] = {
            pending,
            approved,
            total: pending + approved
        };
    });

    return { type: 'stats', stats };
}

// ========================================
// HELPERS
// ========================================
function isEmailRegistered(email, ss, sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return false;

    const emails = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().flat();
    const norm   = email.toLowerCase().trim();

    return emails.some(e => e.toString().toLowerCase().trim() === norm);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatSheetData(data) {
    if (data.length <= 1) return [];
    const headers = data[0].map(h => h.toString().toLowerCase().replace(/[^a-z0-9]/g, ''));
    return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] || '';
        });
        // Add original timestamp in ISO format for approval
        if (row[0] instanceof Date) obj.timestamp = row[0].toISOString();
        return obj;
    });
}

// ========================================
// EMAIL TEMPLATES
// ========================================
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
// ========================================
// RESPONSE HELPERS
// ========================================
function createJsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
                         .setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(message, code = 400) {
    return ContentService.createTextOutput(JSON.stringify({ error: message }))
                         .setMimeType(ContentService.MimeType.JSON);
}