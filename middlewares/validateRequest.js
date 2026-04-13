const { validationResult } = require("express-validator");

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg);
    return res.status(422).json({
      status: false,
      errors: errorMessages
    });
  }
  next();
};



module.exports = validateRequest;
