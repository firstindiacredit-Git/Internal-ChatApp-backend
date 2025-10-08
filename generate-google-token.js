require("dotenv").config({ path: "./config.env" });
const { google } = require("googleapis");
const readline = require("readline");

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

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

async function generateToken() {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n" + "=".repeat(60));
  console.log("📝 GOOGLE DRIVE TOKEN GENERATOR");
  console.log("=".repeat(60));
  console.log("\n📌 Step 1: Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n📌 Step 2: Authorize the app");
  console.log("📌 Step 3: Copy the code from the browser");
  console.log("📌 Step 4: Paste it below and press Enter\n");
  console.log("=".repeat(60) + "\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("🔑 Enter the authorization code: ", async (code) => {
    try {
      const { tokens } = await oAuth2Client.getToken(code);

      console.log("\n" + "=".repeat(60));
      console.log("✅ SUCCESS! Token generated");
      console.log("=".repeat(60));
      console.log("\n📝 Add this line to your Backend/config.env file:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("\n" + "=".repeat(60));
      console.log("🔄 After adding the token, restart your backend server");
      console.log("=".repeat(60) + "\n");

      rl.close();
    } catch (error) {
      console.error("\n❌ Error getting token:", error.message);
      console.log("⚠️  Please try again\n");
      rl.close();
    }
  });
}

generateToken().catch(console.error);
