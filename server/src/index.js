const path = require('path');
const express = require('express');
const accountsRouter = require('./routes/accounts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

app.use('/api/accounts', accountsRouter);

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.listen(PORT, () => {
  console.log(`Loan servicing server listening on http://localhost:${PORT}`);
});
