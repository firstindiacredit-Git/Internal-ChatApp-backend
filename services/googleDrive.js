const { google } = require("googleapis");
const stream = require("stream");
const path = require("path");
const fs = require("fs");

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.initialized = false;
  }

  // Initialize Google Drive API with Service Account or OAuth2
  async initialize() {
    try {
      if (this.initialized) return;

      // Try Service Account first (simpler, no OAuth needed)
      const serviceAccountPath = path.join(
        __dirname,
        "../google-service-account.json"
      );

      if (fs.existsSync(serviceAccountPath)) {
        console.log("🔑 Using Service Account for Google Drive...");
        const auth = new google.auth.GoogleAuth({
          keyFile: serviceAccountPath,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
        });

        this.drive = google.drive({ version: "v3", auth });
        this.initialized = true;
        console.log("✅ Google Drive service initialized with Service Account");
        return;
      }

      // Fallback to OAuth2 if service account not found
      console.log("🔑 Trying OAuth2 for Google Drive...");
      const credentials = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uris: ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
      };

      const { client_id, client_secret, redirect_uris } = credentials;
      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Set refresh token if available
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        oAuth2Client.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        });

        this.drive = google.drive({ version: "v3", auth: oAuth2Client });
        this.auth = oAuth2Client;
        this.initialized = true;
        console.log("✅ Google Drive service initialized with OAuth2");
        return;
      }

      throw new Error(
        "No Google Drive authentication method available. Please setup Service Account or OAuth2."
      );
    } catch (error) {
      console.error("❌ Failed to initialize Google Drive:", error.message);
      throw error;
    }
  }

  // Upload file to Google Drive
  async uploadFile(fileBuffer, fileName, mimeType) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const bufferStream = new stream.PassThrough();
      bufferStream.end(fileBuffer);

      const fileMetadata = {
        name: fileName,
        mimeType: mimeType,
      };

      const media = {
        mimeType: mimeType,
        body: bufferStream,
      };

      console.log(`📤 Uploading ${fileName} to Google Drive...`);

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, name, mimeType, size, webViewLink, webContentLink",
      });

      const fileId = response.data.id;

      // Make file publicly accessible
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      // Get shareable link
      const file = await this.drive.files.get({
        fileId: fileId,
        fields: "id, name, mimeType, size, webViewLink, webContentLink",
      });

      console.log(`✅ File uploaded to Google Drive: ${file.data.name}`);

      return {
        fileId: file.data.id,
        fileName: file.data.name,
        mimeType: file.data.mimeType,
        size: file.data.size,
        webViewLink: file.data.webViewLink,
        webContentLink: file.data.webContentLink,
        directLink: `https://drive.google.com/uc?export=download&id=${file.data.id}`,
      };
    } catch (error) {
      console.error("❌ Google Drive upload error:", error.message);
      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }

  // Delete file from Google Drive
  async deleteFile(fileId) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      await this.drive.files.delete({
        fileId: fileId,
      });

      console.log(`✅ File deleted from Google Drive: ${fileId}`);
      return true;
    } catch (error) {
      console.error("❌ Google Drive delete error:", error.message);
      return false;
    }
  }

  // Get file metadata
  async getFileMetadata(fileId) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const response = await this.drive.files.get({
        fileId: fileId,
        fields: "id, name, mimeType, size, webViewLink, webContentLink",
      });

      return response.data;
    } catch (error) {
      console.error("❌ Google Drive get metadata error:", error.message);
      return null;
    }
  }

  // Generate OAuth URL for first-time setup (optional, for OAuth method)
  getAuthUrl() {
    if (!this.auth) {
      throw new Error("OAuth not initialized. Use Service Account instead.");
    }

    const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
    const authUrl = this.auth.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });

    return authUrl;
  }

  // Get tokens from authorization code (optional, for OAuth method)
  async getTokensFromCode(code) {
    if (!this.auth) {
      await this.initialize();
    }

    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);

    console.log("✅ Google Drive tokens obtained");
    console.log("📝 Add this refresh token to your .env file:");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);

    return tokens;
  }
}

// Export singleton instance
module.exports = new GoogleDriveService();
