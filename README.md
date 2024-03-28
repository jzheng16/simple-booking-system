# Code Review

The body parser library has been built into express since v4.16 and does not need to be installed as a separate package. Instead, use the built in `express.json()` middleware. Optionally, we should also add a middleware to parse url encoded data `express.urlencoded({extended: true})`

We should refactor the sequelize connection to use environment variables instead of it being hardcoded. This not only allows for better flexibility and configuration across multiple environments but also helps hide our secrets by not having them commited to version control.

The code does not account for a User table that can store both provider and patient information. We'll create those to better accomplish the requirements stated. We should also look into creating a separate table to store user's roles (ex: User 1 is a patient and User 2 is a provider) in order to authorize them to different features of the application.

The Booking table has defined a patient and provider field, both of which are string types. This does not make sense since strings are not unique enough to identify a particular patient or provider. Instead, we want to make sure the Booking table has a relationship with the User table which will subsequently define two foreign keys: PatientId and ProviderId. Annoymous bookings will just have the PatientId foreign key as NULL.

The status field on the Booking table should be indexed. This will improve performance significantly when it comes to common features such as when patients view their booking history / filter their bookings by status as well as when providers are looking up statistics on canceled / rescheduled bookings. The PatientId and ProviderId foreign keys are automatically indexed which will also speed up lookups.

Let's also create a one to many relationship between a user and credit.

The executeQuery function isn't being used so we should remove it. We are also not writing any raw SQL queries at the moment. The function also doesn't have any validations in place.

We should add more typing to some of the code, for example: the getStats and getCreditsUsedStats functions.

We should add more input validations specifically around request parameters and queries.

The port should also be stored as an environment variable. The port is environment specific and this will result in an error especially when deploying with 3rd party hosts who set their own ports.

Lastly, since the code is getting more and more complex, we should probably look to split the file into separate files and organize them better. Example would be extracting types, endpoints, and model definitions into their own individual files.