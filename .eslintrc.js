module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": "standard-with-typescript",
    "overrides": [
        {
            "env": {
                "node": true
            },
            "files": [
                ".eslintrc.{js,cjs}"
            ],
            "parserOptions": {
                "sourceType": "script"
            }
        }
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "rules": {
        "@typescript-eslint/strict-boolean-expressions": 0,
        "@typescript-eslint/comma-dangle": 0,
        "@typescript-eslint/dot-notation": 0,
        "@typescript-eslint/indent": 0,
        "@typescript-eslint/consistent-type-definitions": 0,
        "@typescript-eslint/non-nullable-type-assertion-style": 0,
        "no-useless-catch": 0,
        "new-cap": 0,
    }
}