const multer = require('multer');
const path = require('path');
const { httpError } = require('../utils/httpError');

// Stores uploaded Excel files temporarily in /uploads before parsing
const storage = multer.diskStorage({
  // UPLOAD_DIR: a writable folder when installed under Program Files
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname)}`),
});

function fileFilter(req, file, cb) {
  const allowed = ['.xlsx']; // .xls (Excel 97-2003) is not supported by the reader
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(httpError(400, 'Only .xlsx files are allowed. Save the file as Excel Workbook (.xlsx) and try again.'));
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = { upload };
