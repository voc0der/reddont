// Creates a throwaway self-signed TLS certificate for 127.0.0.1, so the HTTPS
// startup test needs no openssl binary and no checked-in private key.
const crypto = require("node:crypto");

// Encodes one DER (ASN.1) value: a tag byte, its length, and its contents.
function der(tag, ...parts) {
	const body = Buffer.concat(parts);
	const size = [];
	for (let n = body.length; n > 0; n >>= 8) size.unshift(n & 0xff);
	const length = body.length < 0x80 ? [body.length] : [0x80 | size.length, ...size];
	return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

const sequence = (...parts) => der(0x30, ...parts);
const oid = (hex) => der(0x06, Buffer.from(hex, "hex"));
const utcTime = (date) => der(0x17, Buffer.from(`${date.toISOString().replace(/\D/g, "").slice(2, 14)}Z`));

function selfSignedCertificate() {
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
	const ecdsaWithSha256 = sequence(oid("2a8648ce3d040302"));
	const name = sequence(der(0x31, sequence(oid("550403"), der(0x0c, Buffer.from("reddont test")))));
	const subjectAltName = sequence(oid("551d11"), der(0x04, sequence(der(0x87, Buffer.from([127, 0, 0, 1])))));
	const now = Date.now();
	const certificateInfo = sequence(
		der(0xa0, der(0x02, Buffer.from([2]))), // X.509 v3
		der(0x02, crypto.randomBytes(8).fill(0x7f, 0, 1)), // positive serial number
		ecdsaWithSha256,
		name,
		sequence(utcTime(new Date(now - 60_000)), utcTime(new Date(now + 3_600_000))),
		name,
		publicKey.export({ type: "spki", format: "der" }),
		der(0xa3, sequence(subjectAltName)),
	);
	const signature = crypto.sign("sha256", certificateInfo, privateKey);
	const certificate = sequence(certificateInfo, ecdsaWithSha256, der(0x03, Buffer.from([0]), signature));
	return {
		cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`,
		key: privateKey.export({ type: "pkcs8", format: "pem" }),
	};
}

module.exports = { selfSignedCertificate };
