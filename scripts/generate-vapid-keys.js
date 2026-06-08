const crypto = require("crypto");

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1"
});

const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const x = Buffer.from(publicJwk.x, "base64url");
const y = Buffer.from(publicJwk.y, "base64url");
const publicVapidKey = base64url(Buffer.concat([Buffer.from([0x04]), x, y]));

console.log("VAPID_PUBLIC_KEY=" + publicVapidKey);
console.log("VAPID_PRIVATE_KEY=" + privateJwk.d);
console.log("VAPID_SUBJECT=mailto:you@example.com");
