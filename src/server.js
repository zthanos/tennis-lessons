const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();

const SECRET_KEY = 'your_secret_key';

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.static(path.join(__dirname, 'src')));
// Serve the 'src' directory under the '/dashboard' path
app.use('/dashboard', express.static(path.join(__dirname, 'src')));

// Ensure database schema is initialized
require('./database');

// Database setup
const db = new sqlite3.Database('./tennis_academy.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Middleware to check if the user is logged in
// Update isAuthenticated middleware to include a query parameter for styling
function isAuthenticated(req, res, next) {
  const token = req.headers.authorization || req.query.token;
  if (!token) {
    return res.redirect('/login?error=unauthorized');
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.redirect('/login?error=unauthorized');
    }
    req.user = decoded;
    next();
  });
}

// Middleware to ensure users can only access their own dashboard
function isAuthorized(req, res, next) {
  const { userId } = req.params;
  if (req.user.id !== parseInt(userId, 10)) {
    return res.status(403).send('Access denied');
  }
  next();
}

// Routes
// Landing page with login and signup options
app.get('/', (req, res) => {
  res.render('landing', { title: 'Tennis Academy Management System' });
});

// Update routes to use separate views for login and signup
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

// Modify signup route to redirect to the dashboard
app.post('/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
    [name, email, hashedPassword, role],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating user' });
      }
      const userId = this.lastID;
      if (role === 'student') {
        res.redirect(`/dashboard/student/${userId}`);
      } else if (role === 'coach') {
        res.redirect('/dashboard/coach');
      }
    }
  );
});

// Modify login route to handle errors and remain on the login page
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1h' });

    if (user.role === 'student') {
      res.redirect(`/dashboard/student/${user.id}?token=${token}`);
    } else if (user.role === 'coach') {
      res.redirect(`/dashboard/coach?token=${token}&name=${encodeURIComponent(user.name)}`);
    }
  });
});

// Add logout route
app.get('/logout', (req, res) => {
  res.redirect('/');
});

// Update subscription creation to redirect back to coach dashboard
app.post('/subscribe', (req, res) => {
  const { userIds, startDate } = req.body; // Accept multiple user IDs

  if (!userIds || userIds.length === 0) {
    return res.status(400).json({ error: 'No students selected for the subscription' });
  }

  db.run(
    `INSERT INTO subscriptions (start_date, remaining_sessions) VALUES (?, 8)`,
    [startDate],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating subscription' });
      }

      const subscriptionId = this.lastID;
      const placeholders = userIds.map(() => '(?, ?)').join(', ');
      const values = userIds.flatMap((userId) => [subscriptionId, userId]);

      db.run(
        `INSERT INTO subscription_students (subscription_id, user_id) VALUES ${placeholders}`,
        values,
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error associating students with subscription' });
          }
          res.redirect('/dashboard/coach');
        }
      );
    }
  );
});

app.get('/subscription/:userId', (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT * FROM subscriptions WHERE user_id = ? AND remaining_sessions > 0`,
    [userId],
    (err, subscription) => {
      if (err) {
        return res.status(500).json({ error: 'Error fetching subscription' });
      }
      if (!subscription) {
        return res.status(404).json({ message: 'No active subscription found' });
      }
      res.json(subscription);
    }
  );
});

// Update lesson creation to subtract 1 from remaining sessions and redirect to coach dashboard
app.post('/lessons', (req, res) => {
  const { date, subscriptionId, studentIds } = req.body;

  db.run(
    `INSERT INTO lessons (date) VALUES (?)`,
    [date],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error creating lesson' });
      }

      const lessonId = this.lastID;
      const placeholders = studentIds.map(() => '(?, ?)').join(', ');
      const values = studentIds.flatMap((studentId) => [lessonId, studentId]);

      db.run(
        `INSERT INTO attendance (lesson_id, user_id) VALUES ${placeholders}`,
        values,
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error recording attendance' });
          }

          const updateQuery = `
            UPDATE subscriptions
            SET remaining_sessions = remaining_sessions - 1
            WHERE id = ? AND remaining_sessions > 0
          `;

          db.run(updateQuery, [subscriptionId], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Error updating subscription sessions' });
            }
            res.redirect('/dashboard/coach');
          });
        }
      );
    }
  );
});

app.post('/attendance', (req, res) => {
  const { lessonId, studentIds } = req.body;

  const placeholders = studentIds.map(() => '(?, ?)').join(', ');
  const values = studentIds.flatMap((id) => [lessonId, id]);

  db.run(
    `INSERT INTO attendance (lesson_id, user_id) VALUES ${placeholders}`,
    values,
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error recording attendance' });
      }

      const updateQuery = `
        UPDATE subscriptions
        SET remaining_sessions = remaining_sessions - 1
        WHERE user_id IN (${studentIds.map(() => '?').join(', ')})
          AND remaining_sessions > 0
      `;

      db.run(updateQuery, studentIds, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error updating subscriptions' });
        }
        res.status(200).json({ message: 'Attendance recorded and subscriptions updated' });
      });
    }
  );
});

// Dashboard & Reporting
// Ensure coachName is passed correctly to the coach dashboard
// Pass the token to the coach dashboard view
app.get('/dashboard/coach', isAuthenticated, (req, res, next) => {
  if (req.user.role !== 'coach') {
    return res.status(403).send('Access denied');
  }
  next();
}, (req, res) => {
  const coachName = req.query.name || 'Coach';

  db.all(
    `SELECT s.id AS subscription_id, s.start_date, s.end_date, s.remaining_sessions, u.id AS student_id, u.name AS student_name
     FROM subscriptions s
     LEFT JOIN subscription_students ss ON s.id = ss.subscription_id
     LEFT JOIN users u ON ss.user_id = u.id
     WHERE u.role = 'student' OR u.role IS NULL`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).send('Error fetching subscriptions and students');
      }

      // Group students under their respective subscriptions
      const subscriptions = rows.reduce((acc, row) => {
        if (!acc[row.subscription_id]) {
          acc[row.subscription_id] = {
            id: row.subscription_id,
            start_date: row.start_date,
            end_date: row.end_date,
            remaining_sessions: row.remaining_sessions,
            students: []
          };
        }
        if (row.student_id) {
          acc[row.subscription_id].students.push({ id: row.student_id, name: row.student_name });
        }
        return acc;
      }, {});

      // Fetch all students for the dropdown
      db.all(
        `SELECT id, name FROM users WHERE role = 'student'`,
        [],
        (err, allStudents) => {
          if (err) {
            return res.status(500).send('Error fetching all students');
          }

          // Fetch lessons and attendance data
          db.all(
            `SELECT l.id AS lesson_id, l.date, a.user_id
             FROM lessons l
             LEFT JOIN attendance a ON l.id = a.lesson_id
             ORDER BY l.date DESC`,
            [],
            (err, lessons) => {
              if (err) {
                return res.status(500).send('Error fetching lessons and attendance');
              }

              // Group attendance by lesson
              const lessonsWithAttendance = lessons.reduce((acc, row) => {
                if (!acc[row.lesson_id]) {
                  acc[row.lesson_id] = { id: row.lesson_id, date: row.date, attendance: [] };
                }
                if (row.user_id) {
                  acc[row.lesson_id].attendance.push(row.user_id);
                }
                return acc;
              }, {});

              res.render('coach_dashboard', {
                coachName: decodeURIComponent(coachName),
                subscriptions: Object.values(subscriptions),
                allStudents,
                lessons: Object.values(lessonsWithAttendance),
                token: req.query.token // Pass the token to the view
              });
            }
          );
        }
      );
    }
  );
});

// Update student dashboard route to include student name in the title
app.get('/dashboard/student/:userId', isAuthenticated, isAuthorized, (req, res) => {
  const { userId } = req.params;

  db.get(
    `SELECT u.name AS student_name, s.remaining_sessions, s.start_date, s.end_date
     FROM users u
     JOIN subscription_students ss ON u.id = ss.user_id
     JOIN subscriptions s ON s.id = ss.subscription_id
     WHERE u.id = ? AND s.remaining_sessions > 0`,
    [userId],
    (err, subscription) => {
      if (err) {
        return res.status(500).send('Error fetching subscription data');
      }

      db.all(
        `SELECT l.date
         FROM attendance a
         JOIN lessons l ON a.lesson_id = l.id
         WHERE a.user_id = ?`,
        [userId],
        (err, lessons) => {
          if (err) {
            return res.status(500).send('Error fetching lesson history');
          }

          res.render('student_dashboard', { studentName: subscription.student_name, subscription, lessons });
        }
      );
    }
  );
});

// Add route for profile view
// Ensure token is passed correctly to the profile route
app.get('/profile', isAuthenticated, (req, res) => {
  const { id } = req.user;

  db.get(`SELECT name, email FROM users WHERE id = ?`, [id], (err, user) => {
    if (err || !user) {
      return res.status(500).send('Error fetching user profile');
    }

    res.render('profile', { user, token: req.query.token });
  });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});