/**
 * Google Apps Script Backend for TechBlog Admin Dashboard
 * COMPLETE CRUD OPERATIONS - Create, Read, Update, Delete
 * 
 * DEPLOYMENT SETTINGS (CRITICAL):
 * - Execute as: "Me"
 * - Who has access: "Anyone"
 * 
 * After code changes: Deploy → Manage deployments → Edit → New version → Deploy
 */

const SHEET_NAME = 'Posts'; 
const REQUIRED_FIELDS = ['title', 'author', 'category', 'excerpt', 'content'];
const SPREADSHEET_ID = '1fFbMI-WPiWBXd_sSZ8PcOZHRdRJJOZIR-IS1RJEMfoA'; 
const HEADERS = ['ID', 'Title', 'Author', 'Category', 'Excerpt', 'Content', 'ImageURL', 'Date'];

/**
 * Setup function - Run this ONCE
 */
function setupSheet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    sheet.clear();
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);
    headerRange.setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
    sheet.setFrozenRows(1);

    Logger.log(`Sheet "${SHEET_NAME}" setup complete!`);
    return { success: true };

  } catch (error) {
    Logger.log(`Setup error: ${error.toString()}`);
    return { success: false, error: error.toString() };
  }
}

/**
 * Handle GET requests (fetch posts)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return buildResponse({ error: `Sheet "${SHEET_NAME}" not found. Run setupSheet() first.` });
    }

    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return buildResponse({ posts: [] });
    }
    
    const headers = data[0];
    const posts = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const post = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j].toLowerCase().replace(/\s/g, '');
        post[key] = row[j];
      }
      posts.push(post);
    }

    return buildResponse({ posts: posts });

  } catch (error) {
    Logger.log(`doGet error: ${error.toString()}`);
    return buildResponse({ error: 'Failed to fetch posts.', details: error.toString() });
  }
}

/**
 * Handle POST requests (create, update, or delete post)
 */
function doPost(e) {
  try {
    let postData;
    
    Logger.log('Received request');
    Logger.log('e.parameter exists: ' + (e.parameter ? 'yes' : 'no'));
    Logger.log('e.postData exists: ' + (e.postData ? 'yes' : 'no'));
    
    // Try e.parameter first (form data)
    if (e.parameter && Object.keys(e.parameter).length > 0) {
      postData = e.parameter;
      Logger.log('Using e.parameter with keys: ' + Object.keys(postData).join(', '));
    } 
    // Fallback to JSON body
    else if (e.postData && e.postData.contents) {
      try {
        postData = JSON.parse(e.postData.contents);
        Logger.log('Using JSON body with keys: ' + Object.keys(postData).join(', '));
      } catch (jsonError) {
        Logger.log('JSON parse failed: ' + jsonError);
        return buildResponse({ error: 'Invalid JSON data' });
      }
    } else {
      Logger.log('No data received in request');
      return buildResponse({ error: 'No data received' });
    }

    // Check for action parameter
    const action = postData.action;
    
    // Handle DELETE action
    if (action === 'delete') {
      return handleDelete(postData.postId);
    }
    
    // Handle UPDATE action
    if (action === 'update' && postData.postId) {
      return handleUpdate(postData);
    }
    
    // Handle CREATE action (default)
    return handleCreate(postData);

  } catch (error) {
    Logger.log(`doPost error: ${error.toString()}`);
    Logger.log(`Error stack: ${error.stack}`);
    return buildResponse({ 
      error: 'Failed to process request.', 
      details: error.toString() 
    });
  }
}

/**
 * Create a new post
 */
function handleCreate(postData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return buildResponse({ error: `Sheet "${SHEET_NAME}" not found.` });
    }

    // Validate required fields
    const missingFields = [];
    for (const field of REQUIRED_FIELDS) {
      if (!postData[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      Logger.log('Missing fields: ' + missingFields.join(', '));
      Logger.log('Available fields: ' + Object.keys(postData).join(', '));
      return buildResponse({ 
        error: `Missing required fields: ${missingFields.join(', ')}`,
        details: 'Available fields: ' + Object.keys(postData).join(', ')
      });
    }
    
    let imageUrl = '';
    
    // Handle image upload
    if (postData.base64Image) {
      Logger.log('Processing image upload...');
      
      try {
        const uploadResult = uploadToCloudinary(postData.base64Image);
        
        if (uploadResult.error) {
          Logger.log(`Cloudinary error: ${uploadResult.error}`);
          imageUrl = 'https://placehold.co/600x400/2563eb/ffffff?text=Upload+Failed';
        } else {
          imageUrl = uploadResult.url;
          Logger.log(`Image uploaded: ${imageUrl}`);
        }
      } catch (uploadError) {
        Logger.log('Image upload exception: ' + uploadError);
        imageUrl = 'https://placehold.co/600x400/2563eb/ffffff?text=Upload+Error';
      }
    } else {
      Logger.log('No image provided, using placeholder');
      imageUrl = 'https://placehold.co/600x400/2563eb/ffffff?text=No+Image';
    }

    // Generate ID and date
    const lastRow = sheet.getLastRow();
    let newId = 1;
    
    if (lastRow > 1) {
      try {
        const lastIdValue = sheet.getRange(lastRow, 1).getValue();
        const lastId = parseInt(lastIdValue);
        newId = (isNaN(lastId) || lastId === 0) ? 1 : lastId + 1;
      } catch (idError) {
        Logger.log('Error getting last ID: ' + idError);
        newId = lastRow;
      }
    }
    
    const dateString = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });

    // Create new row
    const newRow = [
      newId,
      postData.title,
      postData.author,
      postData.category,
      postData.excerpt,
      postData.content,
      imageUrl,
      dateString
    ];

    sheet.appendRow(newRow);
    Logger.log(`Post ${newId} created successfully`);

    return buildResponse({ 
      success: true,
      message: 'Post published successfully!', 
      postId: newId, 
      imageUrl: imageUrl 
    });

  } catch (error) {
    Logger.log(`handleCreate error: ${error.toString()}`);
    return buildResponse({ 
      error: 'Failed to create post.', 
      details: error.toString() 
    });
  }
}

/**
 * Update an existing post
 */
function handleUpdate(postData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return buildResponse({ error: `Sheet "${SHEET_NAME}" not found.` });
    }

    const postId = parseInt(postData.postId);
    if (!postId) {
      return buildResponse({ error: 'Invalid post ID for update' });
    }

    // Find the row with this ID
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (parseInt(data[i][0]) === postId) {
        rowIndex = i + 1; // Sheet rows are 1-indexed
        break;
      }
    }
    
    if (rowIndex === -1) {
      return buildResponse({ error: `Post with ID ${postId} not found` });
    }

    // Validate required fields
    const missingFields = [];
    for (const field of REQUIRED_FIELDS) {
      if (!postData[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      return buildResponse({ 
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Get existing image URL (column 7)
    let imageUrl = sheet.getRange(rowIndex, 7).getValue();
    
    // Only upload new image if base64Image is provided
    if (postData.base64Image) {
      Logger.log('Updating image...');
      
      try {
        const uploadResult = uploadToCloudinary(postData.base64Image);
        
        if (uploadResult.error) {
          Logger.log(`Cloudinary error: ${uploadResult.error}`);
          // Keep existing image on error
        } else {
          imageUrl = uploadResult.url;
          Logger.log(`New image uploaded: ${imageUrl}`);
        }
      } catch (uploadError) {
        Logger.log('Image upload exception: ' + uploadError);
        // Keep existing image on error
      }
    } else {
      Logger.log('No new image provided, keeping existing image');
    }

    // Update the row (keep original ID and date)
    const existingId = sheet.getRange(rowIndex, 1).getValue();
    const existingDate = sheet.getRange(rowIndex, 8).getValue();
    
    const updatedRow = [
      existingId,           // Keep original ID
      postData.title,
      postData.author,
      postData.category,
      postData.excerpt,
      postData.content,
      imageUrl,             // Updated or existing image
      existingDate          // Keep original date
    ];

    // Update the entire row
    sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([updatedRow]);
    Logger.log(`Post ${postId} updated successfully`);

    return buildResponse({ 
      success: true,
      message: 'Post updated successfully!', 
      postId: postId,
      imageUrl: imageUrl 
    });

  } catch (error) {
    Logger.log(`handleUpdate error: ${error.toString()}`);
    return buildResponse({ 
      error: 'Failed to update post.', 
      details: error.toString() 
    });
  }
}

/**
 * Delete a post
 */
function handleDelete(postId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return buildResponse({ error: `Sheet "${SHEET_NAME}" not found.` });
    }

    const id = parseInt(postId);
    if (!id) {
      return buildResponse({ error: 'Invalid post ID for deletion' });
    }

    // Find and delete the row with this ID
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (parseInt(data[i][0]) === id) {
        sheet.deleteRow(i + 1); // Sheet rows are 1-indexed
        Logger.log(`Post ${id} deleted successfully`);
        return buildResponse({ 
          success: true,
          message: 'Post deleted successfully!',
          postId: id 
        });
      }
    }
    
    return buildResponse({ error: `Post with ID ${id} not found` });

  } catch (error) {
    Logger.log(`handleDelete error: ${error.toString()}`);
    return buildResponse({ 
      error: 'Failed to delete post.', 
      details: error.toString() 
    });
  }
}

/**
 * Upload image to Cloudinary using signed upload
 */
function uploadToCloudinary(base64Data) {
  const CLOUD_NAME = PropertiesService.getScriptProperties().getProperty('CLOUD_NAME');
  const API_KEY = PropertiesService.getScriptProperties().getProperty('API_KEY');
  const API_SECRET = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return { error: 'Cloudinary credentials not configured in Script Properties.' };
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  const folder = "blog-posts-admin";
  
  const signatureString = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`;
  
  const signature = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    signatureString,
    Utilities.Charset.UTF_8
  ).map(function(byte) {
    const v = (byte < 0) ? 256 + byte : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  
  const boundary = '----WebKitFormBoundary' + Utilities.getUuid().replace(/-/g, '');
  let payload = '';
  
  payload += '--' + boundary + '\r\n';
  payload += 'Content-Disposition: form-data; name="file"\r\n\r\n';
  payload += base64Data + '\r\n';
  
  payload += '--' + boundary + '\r\n';
  payload += 'Content-Disposition: form-data; name="api_key"\r\n\r\n';
  payload += API_KEY + '\r\n';
  
  payload += '--' + boundary + '\r\n';
  payload += 'Content-Disposition: form-data; name="timestamp"\r\n\r\n';
  payload += timestamp + '\r\n';
  
  payload += '--' + boundary + '\r\n';
  payload += 'Content-Disposition: form-data; name="signature"\r\n\r\n';
  payload += signature + '\r\n';
  
  payload += '--' + boundary + '\r\n';
  payload += 'Content-Disposition: form-data; name="folder"\r\n\r\n';
  payload += folder + '\r\n';
  
  payload += '--' + boundary + '--\r\n';

  const options = {
    method: 'post',
    contentType: 'multipart/form-data; boundary=' + boundary,
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (response.getResponseCode() === 200 && result.secure_url) {
      Logger.log('Cloudinary upload successful: ' + result.secure_url);
      return { url: result.secure_url };
    } else {
      Logger.log('Cloudinary error response: ' + response.getContentText());
      return { error: result.error ? result.error.message : 'Unknown Cloudinary error' };
    }
  } catch (e) {
    Logger.log('Cloudinary API exception: ' + e.toString());
    return { error: 'Cloudinary API call failed: ' + e.toString() };
  }
}

/**
 * Build JSON response
 */
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}