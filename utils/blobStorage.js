// utils/blobStorage.js
const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } = require('@azure/storage-blob');

const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER;
const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Parse account name/key out of the connection string for SAS signing
const accountName = connStr.match(/AccountName=([^;]+)/)[1];
const accountKey = connStr.match(/AccountKey=([^;]+)/)[1];
const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

async function uploadMaterial(unitId, file) {
  const blobName = `${unitId}/${Date.now()}-${file.originalname}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: { blobContentType: file.mimetype }
  });
  return blobName; // stored in DB — not a public URL, since container is private
}

// getSasUrl(blobName) — unchanged behaviour, existing callers keep working.
// getSasUrl(blobName, { download: true, fileName }) — new: sets
// Content-Disposition: attachment on the SAS token so the browser saves
// the file instead of opening it inline.
function getSasUrl(blobName, options = {}) {
  const { expiryMinutes = 60, download = false, fileName } = options;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  const sasOptions = {
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
  };

  if (download) {
    const name = fileName || blobName.split('/').pop();
    sasOptions.contentDisposition = `attachment; filename="${name}"`;
  }

  const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
  return `${blockBlobClient.url}?${sasToken}`;
}

async function deleteBlob(blobName) {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

module.exports = { uploadMaterial, getSasUrl, deleteBlob };