/*
I asked chatGPT to build for me a simple booking system with features for creating both standard and anonymous bookings. 
Users can specify details like time, patient, provider, and booking status. 
The application records booking status changes over time, providing a comprehensive status history. 
Additionally, it associates bookings with unused credits and allows users to retrieve their booking history or the timeline of status changes for a specific booking. 
The database is managed through Sequelize, offering a relational mapping to a MySQL database.
Please also allow to show the provider some statistic about bookings getting canceled by the client and being rescheduled, and the patient statistic about how many credits he used per month.
*/

import express, { Request, Response } from "express";
import { Sequelize, DataTypes } from "sequelize";
require("dotenv").config();

const app = express();
const port = 3000;

// Middleware to parse JSON requests
app.use(express.json());
// Parse form url encoded data as well
app.use(express.urlencoded({ extended: true }));

// Create a single persistent MySQL database connection pool
const sequelize = new Sequelize(
  process.env.DATABASE_NAME,
  process.env.DATABASE_USERNAME,
  process.env.DATABASE_PASSWORD,
  {
    host: "localhost",
    dialect: "mysql", // Use the appropriate database dialect
    logging: false, // Disable logging SQL queries (you can enable it for debugging)
  }
);

// Define user table to store patient / provider information
const User = sequelize.define(
  "User",
  {
    email: {
      type: DataTypes.String,
      allowNull: false,
    },
    firstName: {
      type: DataTypes.String,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.String,
      allowNull: false,
    },
    // Add any other relevant fields
  },
  {
    indexes: [
      // Create a unique index on email
      {
        unique: true,
        fields: ["email"],
      },
    ],
  }
);

// Define the Credit model
const Credit = sequelize.define("Credit", {
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  expirationDate: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: true,
      isAfter: new Date().toISOString(),
    },
  },
});

// Define the Booking model
const Booking = sequelize.define("Booking", {
  time: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: true,
      isAfter: new Date().toISOString(),
    },
  },
  patient: {
    type: DataTypes.STRING,
    allowNull: true, // Allow anonymous bookings
  },
  provider: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "pending", // Default status
  },
});

const BookingStatusHistory = sequelize.define("BookingStatusHistory", {
  status: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
  },
});

// Define the relationship between Booking and Credit
Booking.belongsTo(Credit);
Credit.hasOne(Booking);

// Define the relationship between Booking and BookingStatusHistory
Booking.hasMany(BookingStatusHistory);
BookingStatusHistory.belongsTo(Booking);

// Function to execute database queries
async function executeQuery(query: string, params: any[] = []) {
  const connection = await sequelize.getConnection();
  try {
    const [rows] = await connection.query(query, params);
    return rows;
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

// Function to get statistics on canceled and rescheduled bookings for a specific provider
async function getStats(providerId) {
  try {
    // Retrieve canceled and rescheduled bookings for the specified provider
    const stats = await Booking.findAll({
      attributes: [
        [
          sequelize.fn(
            "COUNT",
            sequelize.literal(
              'DISTINCT CASE WHEN status = "canceled" THEN id END'
            )
          ),
          "canceledBookings",
        ],
        [
          sequelize.fn(
            "COUNT",
            sequelize.literal(
              'DISTINCT CASE WHEN status = "rescheduled" THEN id END'
            )
          ),
          "rescheduledBookings",
        ],
      ],
      where: {
        provider: providerId,
        [sequelize.Op.or]: [{ status: "canceled" }, { status: "rescheduled" }],
      },
    });

    // Extract the results from the stats
    const [result] = stats;

    // Prepare the statistic information
    const canceledBookings = result.getDataValue("canceledBookings") || 0;
    const rescheduledBookings = result.getDataValue("rescheduledBookings") || 0;

    return [canceledBookings, rescheduledBookings];
  } catch (error) {
    console.error(
      "Error getting cancellation and reschedule statistics:",
      error
    );
    throw error;
  }
}

// Function to get monthly statistics on credits used by a specific patient, including the percentage
async function getCreditsUsedStats(patientId) {
  try {
    // Retrieve total credits available for the specified patient
    const totalCreditsQuery = await Credit.sum("type", {
      where: {
        BookingId: null, // Credits not associated with any booking
      },
    });

    // Retrieve monthly credits used by the specified patient
    const stats = await Booking.findAll({
      attributes: [
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(
              'CASE WHEN "Booking"."status" = "confirmed" THEN "Credit"."type" END'
            )
          ),
          "totalCreditsUsed",
        ],
        [sequelize.fn("MONTH", sequelize.col('"Booking"."time"')), "month"],
        [sequelize.fn("YEAR", sequelize.col('"Booking"."time"')), "year"],
      ],
      include: [
        {
          model: Credit,
          attributes: [],
          where: {
            BookingId: sequelize.literal('"Booking"."id"'), // Match Credit to Booking
          },
        },
      ],
      where: {
        patient: patientId,
        status: "confirmed",
      },
      group: ["month", "year"],
    });

    // Extract the results from the stats
    const result = stats.map((row) => ({
      totalCreditsUsed: row.getDataValue("totalCreditsUsed") || 0,
      month: row.getDataValue("month"),
      year: row.getDataValue("year"),
    }));

    // Calculate the percentage for each month
    const totalCreditsAvailable = totalCreditsQuery || 1; // To avoid division by zero
    const monthlyStatsWithPercentage = result.map((row) => ({
      ...row,
      percentageCreditsUsed:
        (row.totalCreditsUsed / totalCreditsAvailable) * 100,
    }));

    return monthlyStatsWithPercentage;
  } catch (error) {
    console.error("Error getting monthly credits used statistics:", error);
    throw error;
  }
}

// Endpoint to create a booking with an unused credit
app.post("/bookings", async (req: Request, res: Response) => {
  const { time, patient, provider } = req.body;

  try {
    // Find an unused credit that is not expired
    const d = new Date();
    const credit = await Credit.findOne({
      where: {
        expirationDate: {
          [sequelize.Op.gt]: d, // Expiration date is greater than the current date
        },
        BookingId: null, // Credit is not associated with any booking
      },
    });

    if (!credit) {
      return res
        .status(404)
        .json({ error: "No unused, non-expired credits found." });
    }

    // Create a booking associated with the credit
    const booking = await Booking.create({ time, patient, provider });

    // Record the initial status in the booking status history
    await BookingStatusHistory.create({ status, BookingId: booking.id });

    // Associate the booking with the credit
    await booking.setCredit(credit);

    res.status(201).json({
      message: "Booking created successfully",
      booking: booking.toJSON(),
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    res
      .status(500)
      .json({ error: "An error occurred while creating the booking." });
  }
});

// Endpoint to retrieve bookings for a specific user (patient or provider)
app.get("/bookings", async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res
      .status(400)
      .json({ error: "User ID must be provided as a query parameter." });
  }

  try {
    // Retrieve bookings from the database for the specified user
    const bookings = await Booking.findAll({
      where: {
        [sequelize.Op.or]: [{ patient: userId }, { provider: userId }],
      },
    });

    let stats = [];
    if (bookings?.[0].provider === userId) stats = await getStats(userId);

    res.status(200).json({ bookings, stats });
  } catch (error) {
    console.error("Error retrieving bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while retrieving bookings." });
  }
});

app.get("/bookings/:bookingId/history", async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  try {
    // Retrieve the booking status history from the database for the specified booking
    const history = await BookingStatusHistory.findAll({
      where: { BookingId: bookingId },
      order: [["timestamp", "ASC"]], // Order by timestamp in ascending order
    });

    res.status(200).json({ history });
  } catch (error) {
    console.error("Error retrieving booking status history:", error);
    res.status(500).json({
      error: "An error occurred while retrieving booking status history.",
    });
  }
});

app.get("/credits/:patientId", async (req: Request, res: Response) => {
  const { patientId } = req.params;

  try {
    // get credits for the specified patient
    const credits = await Credit.findAll({
      where: {
        patient: patientId,
      },
    });
    // Retrieve the monthly credits used statistics from the database for the specified patient
    const stats = await getCreditsUsedStats(patientId);

    res.status(200).json({ credits, stats });
  } catch (error) {
    console.error("Error retrieving monthly credits used statistics:", error);
    res.status(500).json({
      error:
        "An error occurred while retrieving monthly credits used statistics.",
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
