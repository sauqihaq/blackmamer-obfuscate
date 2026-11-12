'use strict';
// Issued keys are BM- followed by six groups of six uppercase hex chars.
// Preserve every key issued by commercial-access.js while rejecting loose,
// ambiguous legacy shapes before hitting the database.
const pattern=/^BM-(?:[A-F0-9]{6}-){5}[A-F0-9]{6}$/;
const isLicense=value=>typeof value==='string'&&pattern.test(value);
module.exports={isLicense};
