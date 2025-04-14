const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./tennis_academy.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');

    // Create Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'coach'))
    )`, (err) => {
      if (err) console.error('Error creating users table:', err.message);
    });

    // Drop and recreate Subscriptions table without user_id
    db.serialize(() => {
      db.run(`PRAGMA foreign_keys = OFF;`);
      db.run(`CREATE TABLE IF NOT EXISTS subscriptions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_date TEXT NOT NULL,
        end_date TEXT,
        remaining_sessions INTEGER NOT NULL DEFAULT 8
      );`);
      db.run(`INSERT INTO subscriptions_new (id, start_date, end_date, remaining_sessions)
              SELECT id, start_date, end_date, remaining_sessions FROM subscriptions;`);
      db.run(`DROP TABLE subscriptions;`);
      db.run(`ALTER TABLE subscriptions_new RENAME TO subscriptions;`);
      db.run(`PRAGMA foreign_keys = ON;`);
    });

    // Create Subscription_Students table
    db.run(`CREATE TABLE IF NOT EXISTS subscription_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`, (err) => {
      if (err) console.error('Error creating subscription_students table:', err.message);
    });

    // Create Lessons table
    db.run(`CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL
    )`, (err) => {
      if (err) console.error('Error creating lessons table:', err.message);
    });

    // Create Attendance table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY(lesson_id) REFERENCES lessons(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`, (err) => {
      if (err) console.error('Error creating attendance table:', err.message);
    });

    // Reset passwords for all users
    const coachPassword = bcrypt.hashSync('coach@123', 10);
    const playerPassword = bcrypt.hashSync('player@123', 10);

    db.serialize(() => {
      db.run(
        `UPDATE users SET password = CASE 
          WHEN role = 'coach' THEN ? 
          WHEN role = 'student' THEN ? 
        END`,
        [coachPassword, playerPassword],
        (err) => {
          if (err) {
            console.error('Error resetting passwords:', err.message);
          } else {
            console.log('Passwords reset successfully.');
          }
        }
      );
    });
  }
});

module.exports = db;