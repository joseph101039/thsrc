'use strict';

const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, emailVerified: payload.email_verified };
}

function signJwt(email, role) {
  return jwt.sign({ email, role }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { verifyGoogleCredential, signJwt };
