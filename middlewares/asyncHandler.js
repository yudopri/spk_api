/**
 * Bungkus handler async supaya rejection (error tak tertangani) diteruskan ke
 * Express error handler (4-arg) dan selalu menghasilkan response JSON 500,
 * bukan request yang menggantung sampai timeout.
 */
function asyncHandler(fn) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
