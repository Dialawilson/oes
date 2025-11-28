/**
 * Blog Admin Dashboard Backend (Google Apps Script)
 * Enhanced with PDF upload to Google Drive, public sharing, and unique post URLs.
 */

const SHEET_NAME = 'Posts';
const PROPERTIES = PropertiesService.getScriptProperties();
// Keeping Cloudinary credentials for image uploads, as requested in the original code.
const CLOUDINARY_CLOUD_NAME = PROPERTIES.getProperty('CLOUDINARY_CLOUD_NAME') || 'your_cloud_name';
const CLOUDINARY_UPLOAD_PRESET = PROPERTIES.getProperty('CLOUDINARY_UPLOAD_PRESET') || 'your_upload_preset';
const SPREADSHEET_ID = PROPERTIES.getProperty('SPREADSHEET_ID');

/**
 * Initializes the Google Sheet database.
 */
function setupSheets() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // UPDATED HEADERS: Replaced PDFUrl with DriveFileId and PDFPreviewURL
    const headers = ['ID', 'Date', 'Title', 'Author', 'Category', 'Excerpt', 'Content', 'ImageURLs', 'DriveFileId', 'PDFPreviewURL', 'YouTubeURL', 'Slug'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    Logger.log('Created new sheet: ' + SHEET_NAME);
  }
  return sheet;
}

// --- Main Request Handlers ---

function doGet(e) {
  try {
    const sheet = setupSheets();
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return createJsonResponse({ posts: [] });
    }

    const headers = data[0];
    const posts = data.slice(1).map(row => {
      const post = {};
      headers.forEach((header, i) => {
        let value = row[i];
        if (header === 'ImageURLs' && value) {
          try {
            value = JSON.parse(value);
          } catch (err) {
            value = [];
            Logger.log('Error parsing ImageURLs: ' + err.message);
          }
        }
        post[header.toLowerCase().replace(/ /g, '')] = value;
      });
      return post;
    });

    return createJsonResponse({ posts: posts });

  } catch (error) {
    Logger.log('Error in doGet: ' + error.message);
    return createErrorResponse('Failed to fetch posts: ' + error.message, 500);
  }
}

function doPost(e) {
  try {
    // Ensure all data is processed, especially for files
    const params = e.parameter;
    const action = params.action || 'create';
    const sheet = setupSheets();

    switch (action) {
      case 'create':
        return handleCreate(sheet, params);
      case 'update':
        return handleUpdate(sheet, params);
      case 'delete':
        return handleDelete(sheet, params);
      default:
        return createErrorResponse('Invalid action specified.', 400);
    }
  } catch (error) {
    Logger.log('Error in doPost: ' + error.message);
    return createErrorResponse('Operation failed: ' + error.message, 500);
  }
}

// --- Action Handlers ---

function handleCreate(sheet, params) {
  const newId = sheet.getLastRow();
  // If the sheet is empty (only header row exists), nextId is 1. Otherwise, it's the last row index.
  const nextId = newId === 0 ? 1 : newId; 

  const imageURLs = uploadImages(params.base64Images);
  const slug = generateSlug(params.title || 'untitled-post');
  const youtubeURL = extractYouTubeID(params.youtubeURL) || '';

  // NEW: Upload PDF to Google Drive
  const pdfInfo = uploadPDFToDrive(params.base64PDF, params.title || 'Untitled Post');
  const driveFileId = pdfInfo.fileId;
  const pdfPreviewURL = pdfInfo.previewUrl;

  const rowData = [
    nextId,
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    params.title || 'Untitled Post',
    params.author || 'Anonymous',
    params.category || 'Press Releases',
    params.excerpt || '',
    params.content || '',
    JSON.stringify(imageURLs),
    driveFileId,      // New Column: Drive File ID
    pdfPreviewURL,    // New Column: Public Preview URL
    youtubeURL,
    slug
  ];

  sheet.appendRow(rowData);
  return createJsonResponse({ 
    status: 'success', 
    message: 'Post created successfully', 
    id: nextId,
    slug: slug 
  });
}

function handleUpdate(sheet, params) {
  const postId = parseInt(params.postId);
  if (isNaN(postId)) {
    return createErrorResponse('Invalid Post ID for update.', 400);
  }

  const allData = sheet.getDataRange().getValues();
  // Row index in sheet is postId (since ID starts at 1)
  const rowIdx = postId;

  if (rowIdx < 1 || rowIdx >= allData.length) {
    return createErrorResponse('Post not found.', 404);
  }
  
  let existingUrls = [];
  if (params.existingImageURLs) {
    try {
      existingUrls = JSON.parse(params.existingImageURLs);
    } catch (e) {
      Logger.log('Error parsing existingImageURLs: ' + e.message);
      return createErrorResponse('Invalid existing image URL format.', 400);
    }
  }

  const newImageURLs = uploadImages(params.base64Images);
  const finalImageURLs = existingUrls.concat(newImageURLs);

  // Column Indices (0-based):
  // 8: DriveFileId, 9: PDFPreviewURL, 10: YouTubeURL, 11: Slug

  // Handle PDF: keep existing or upload new
  let driveFileId = allData[rowIdx][8] || '';    // Existing DriveFileId
  let pdfPreviewURL = allData[rowIdx][9] || '';  // Existing PDFPreviewURL

  if (params.base64PDF) {
    // If a new PDF is uploaded, upload it to Drive
    const pdfInfo = uploadPDFToDrive(params.base64PDF, params.title || 'Untitled Post');
    driveFileId = pdfInfo.fileId || driveFileId;
    pdfPreviewURL = pdfInfo.previewUrl || pdfPreviewURL;
  }

  const youtubeURL = params.youtubeURL ? extractYouTubeID(params.youtubeURL) : (allData[rowIdx][10] || '');
  const slug = allData[rowIdx][11] || generateSlug(params.title || 'untitled-post');

  const updatedData = [
    postId,
    allData[rowIdx][1] || new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    params.title || 'Untitled Post',
    params.author || 'Anonymous',
    params.category || 'Press Releases',
    params.excerpt || '',
    params.content || '',
    JSON.stringify(finalImageURLs),
    driveFileId,      // Index 8
    pdfPreviewURL,    // Index 9
    youtubeURL,       // Index 10
    slug              // Index 11
  ];
  
  sheet.getRange(rowIdx + 1, 1, 1, updatedData.length).setValues([updatedData]);
  
  return createJsonResponse({ 
    status: 'success', 
    message: 'Post updated successfully', 
    id: postId,
    slug: slug 
  });
}

function handleDelete(sheet, params) {
  const postId = parseInt(params.postId);
  if (isNaN(postId)) {
    return createErrorResponse('Invalid Post ID for delete.', 400);
  }

  const data = sheet.getDataRange().getValues();
  let rowToDelete = -1;
  
  // Find the row index (1-based) where the ID matches
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === postId) {
      rowToDelete = i + 1;
      break;
    }
  }

  if (rowToDelete === -1) {
    return createErrorResponse('Post not found.', 404);
  }

  sheet.deleteRow(rowToDelete);

  return createJsonResponse({ status: 'success', message: 'Post deleted successfully', id: postId });
}

// --- Media Upload Functions ---

/**
 * Uploads Base64 images to Cloudinary (Kept from original request for continuity).
 */
function uploadImages(base64Images) {
  if (!base64Images) return [];
  
  // Assuming a single or array of base64 strings
  const imagesToUpload = Array.isArray(base64Images) ? base64Images : [base64Images];
  const uploadedUrls = [];
  
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    Logger.log("Cloudinary credentials not set. Skipping image upload.");
    return [];
  }
  
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  
  imagesToUpload.forEach(base64Data => {
    // Cloudinary expects data URI format, which might be provided by the client
    const cleanedBase64 = base64Data.split(',').length > 1 ? base64Data : `data:image/png;base64,${base64Data}`;

    const payload = {
      upload_preset: CLOUDINARY_UPLOAD_PRESET,
      file: cleanedBase64
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch(uploadUrl, options);
      const jsonResponse = JSON.parse(response.getContentText());
      
      if (jsonResponse.secure_url) {
        uploadedUrls.push(jsonResponse.secure_url);
        Logger.log('Image uploaded successfully: ' + jsonResponse.secure_url);
      } else if (jsonResponse.error) {
        Logger.log('Cloudinary upload error: ' + jsonResponse.error.message);
      } else {
        Logger.log('Unknown Cloudinary response: ' + response.getContentText());
      }
    } catch (e) {
      Logger.log('Network/Parsing error during Cloudinary fetch: ' + e.message);
    }
  });
  
  return uploadedUrls;
}

/**
 * Uploads a base64 encoded PDF file to Google Drive, sets permissions to public,
 * and returns the file ID and the public preview URL.
 */
function uploadPDFToDrive(base64PDF, title) {
  if (!base64PDF) return { fileId: '', previewUrl: '' };

  try {
    // 1. Convert Base64 string to Blob
    const dataParts = base64PDF.split(',');
    if (dataParts.length < 2) throw new Error('Invalid Base64 format.');
    
    const base64Content = dataParts[1];
    // Attempt to parse mimeType from data URI, default to application/pdf
    const mimeType = dataParts[0].match(/:(.*?);/)?.[1] || 'application/pdf';

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Content), mimeType, title + '.pdf');

    // 2. Upload to Drive (will go to the root folder by default)
    const file = DriveApp.createFile(blob);
    
    // 3. Make the file publicly accessible (Anyone with the link can view)
    file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    // 4. Construct the required Google Preview URL format
    const previewUrl = `https://drive.google.com/file/d/${fileId}/view`;

    Logger.log('PDF uploaded to Drive successfully. File ID: ' + fileId);
    return { fileId: fileId, previewUrl: previewUrl };

  } catch (e) {
    Logger.log('Error during PDF upload to Drive: ' + e.message);
    return { fileId: '', previewUrl: '' };
  }
}

/**
 * Extracts YouTube video ID from URL
 */
function extractYouTubeID(url) {
  if (!url) return '';
  
  // Handle various YouTube URL formats (watch, youtu.be, embed)
  const patterns = [
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&\n?#]+)/i,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];
  
  for (let pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return '';
}

/**
 * Generates URL-friendly slug from title
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .substring(0, 60); // Limit to 60 characters
}

// --- Utility Functions ---

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(message, code) {
  return ContentService.createTextOutput(JSON.stringify({ 
    error: message, 
    details: 'Status Code: ' + code 
  }))
    .setMimeType(ContentService.MimeType.JSON);
}