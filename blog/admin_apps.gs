/**
 * Blog Admin Dashboard Backend (Google Apps Script)
 * * Handles requests from the HTML frontend (doGet, doPost) to manage blog posts
 * stored in a Google Sheet and uploads images to Cloudinary.
 * * IMPORTANT: Replace placeholder values for Cloudinary in the Properties Service setup.
 */

// --- Configuration ---

const SHEET_NAME = 'Posts';
const PROPERTIES = PropertiesService.getScriptProperties();
// Retrieve the Cloudinary credentials from script properties (Set these via Script Editor -> Project Settings -> Script Properties)
const CLOUDINARY_CLOUD_NAME = PROPERTIES.getProperty('CLOUDINARY_CLOUD_NAME') || 'your_cloud_name';
const CLOUDINARY_UPLOAD_PRESET = PROPERTIES.getProperty('CLOUDINARY_UPLOAD_PRESET') || 'your_upload_preset';
// The ID of the spreadsheet to use (optional, uses the script's bound spreadsheet by default)
const SPREADSHEET_ID = PROPERTIES.getProperty('SPREADSHEET_ID');

/**
 * Initializes the Google Sheet database.
 */
function setupSheets() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', 'Date', 'Title', 'Author', 'Category', 'Excerpt', 'Content', 'ImageURLs'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    Logger.log('Created new sheet: ' + SHEET_NAME);
  }
  return sheet;
}

// --- Main Request Handlers ---

/**
 * Handles GET requests to retrieve all blog posts.
 * @param {object} e The event parameter for a GET request.
 * @returns {object} JSON response of all posts.
 */
function doGet(e) {
  try {
    const sheet = setupSheets();
    const data = sheet.getDataRange().getValues();
    
    // Check if only headers exist
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
            // ImageURLs are stored as a JSON string array
            value = JSON.parse(value);
          } catch (err) {
            value = []; // Handle parsing error
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

/**
 * Handles POST requests to create, update, or delete blog posts.
 * @param {object} e The event parameter for a POST request.
 * @returns {object} JSON response confirming success or reporting error.
 */
function doPost(e) {
  try {
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

/**
 * Handles the creation of a new blog post.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The target sheet.
 * @param {object} params The POST request parameters.
 */
function handleCreate(sheet, params) {
  const newId = sheet.getLastRow(); // Get last row index (1-based), new ID will be index + 1
  const nextId = newId === 0 ? 1 : newId; // Use 1 if sheet is empty (only headers)

  const imageURLs = uploadImages(params.base64Images);

  const rowData = [
    nextId, // ID
    new Date().toLocaleDateString('en-US'), // Date
    params.title || 'Untitled Post', // Title
    params.author || 'Anonymous', // Author
    params.category || 'Press Releases', // Category
    params.excerpt || '', // Excerpt
    params.content || '', // Content
    JSON.stringify(imageURLs) // ImageURLs (Stored as JSON string)
  ];

  sheet.appendRow(rowData);
  return createJsonResponse({ status: 'success', message: 'Post created successfully', id: nextId });
}

/**
 * Handles the update of an existing blog post.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The target sheet.
 * @param {object} params The POST request parameters.
 */
function handleUpdate(sheet, params) {
  const postId = parseInt(params.postId);
  if (isNaN(postId)) {
    return createErrorResponse('Invalid Post ID for update.', 400);
  }

  const allData = sheet.getDataRange().getValues();
  // Row index is postId (since we start ID from 1 and data starts at row 2)
  const rowIdx = postId;

  if (rowIdx < 1 || rowIdx >= allData.length) {
    return createErrorResponse('Post not found.', 404);
  }
  
  // 1. Handle Images
  let existingUrls = [];
  if (params.existingImageURLs) {
      try {
          // existingImageURLs is sent as a JSON string array from frontend
          existingUrls = JSON.parse(params.existingImageURLs);
      } catch (e) {
          Logger.log('Error parsing existingImageURLs: ' + e.message);
          return createErrorResponse('Invalid existing image URL format.', 400);
      }
  }

  // Upload any new base64 images
  const newImageURLs = uploadImages(params.base64Images);
  
  // Combine existing (kept) and newly uploaded URLs
  const finalImageURLs = existingUrls.concat(newImageURLs);


  // 2. Prepare new data array
  const updatedData = [
    postId, // ID (Unchanged)
    allData[rowIdx][1] || new Date().toLocaleDateString('en-US'), // Date (Keep existing date)
    params.title || 'Untitled Post', // Title
    params.author || 'Anonymous', // Author
    params.category || 'Press Releases', // Category
    params.excerpt || '', // Excerpt
    params.content || '', // Content
    JSON.stringify(finalImageURLs) // ImageURLs (Updated JSON string)
  ];
  
  // Update the row (rowIdx + 1 because sheet is 1-indexed)
  sheet.getRange(rowIdx + 1, 1, 1, updatedData.length).setValues([updatedData]);
  
  return createJsonResponse({ status: 'success', message: 'Post updated successfully', id: postId });
}

/**
 * Handles the deletion of an existing blog post.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The target sheet.
 * @param {object} params The POST request parameters.
 */
function handleDelete(sheet, params) {
  const postId = parseInt(params.postId);
  if (isNaN(postId)) {
    return createErrorResponse('Invalid Post ID for delete.', 400);
  }

  // Row index is postId + 1 (1 for headers)
  // Since IDs are appended sequentially, Row index should match ID + 1.
  // We need to iterate to find the actual row number (1-based index)
  const data = sheet.getDataRange().getValues();
  let rowToDelete = -1;
  
  // Find the row number by ID
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === postId) {
      rowToDelete = i + 1; // Apps Script row index (1-based)
      break;
    }
  }

  if (rowToDelete === -1) {
    return createErrorResponse('Post not found.', 404);
  }

  sheet.deleteRow(rowToDelete);
  
  // NOTE: This leaves a gap in IDs, but the client side uses IDs not row index.
  // The client side re-sorts by ID on load.

  return createJsonResponse({ status: 'success', message: 'Post deleted successfully', id: postId });
}

// --- Image & Utility Functions ---

/**
 * Uploads an array of base64 images to Cloudinary.
 * @param {string[]|string} base64Images Base64 string(s) of images.
 * @returns {string[]} Array of secure image URLs.
 */
function uploadImages(base64Images) {
  if (!base64Images) return [];
  
  // Ensure we are working with an array, even if only one image was sent
  const imagesToUpload = Array.isArray(base64Images) ? base64Images : [base64Images];
  
  const uploadedUrls = [];
  
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      Logger.log("Cloudinary credentials not set. Skipping image upload.");
      return [];
  }
  
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  
  imagesToUpload.forEach(base64Data => {
    // Clean up the base64 string (remove data prefix)
    const cleanedBase64 = base64Data.split(',')[1] || base64Data;
    
    // Cloudinary requires the full data URI (e.g., 'data:image/png;base64,...')
    const dataUri = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${cleanedBase64}`;

    const payload = {
      upload_preset: CLOUDINARY_UPLOAD_PRESET,
      file: dataUri
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
      } else {
        Logger.log('Cloudinary upload error: ' + jsonResponse.error.message);
      }
    } catch (e) {
      Logger.log('Network/Parsing error during Cloudinary fetch: ' + e.message);
    }
  });
  
  return uploadedUrls;
}

/**
 * Creates a standard JSON response.
 * @param {object} data The data object to return.
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Creates an error JSON response.
 * @param {string} message The error message.
 * @param {number} code The HTTP status code (used for logging/debugging, not actual HTTP status).
 */
function createErrorResponse(message, code) {
  return ContentService.createTextOutput(JSON.stringify({ 
    error: message, 
    details: 'Status Code: ' + code 
  }))
    .setMimeType(ContentService.MimeType.JSON);
}