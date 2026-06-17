const bcrypt = require("bcryptjs");

bcrypt.hash("RICHSON-DATA-HUB", 12).then((hash) => {
  console.log(hash);
});