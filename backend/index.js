// Required modules
const express = require('express');
const cors = require('cors');
const connectDB = require('./db.js');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoute.js')
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer')

// Load environment variables
dotenv.config();

let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: process.env.email,
    pass: process.env.password,
    clientId: process.env.OAUTH_CLIENTID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    refreshToken: process.env.OAUTH_REFRESH_TOKEN
  }
});

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// User schema and model (consider moving these to a separate model file)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const User = mongoose.model('User', userSchema);

//Otp Schema for verifying opt
const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 600 // 600 seconds = 10 minutes
  }
});

const Otpdata = mongoose.model('otp', otpSchema)

// Product schema and model (move to separate model file)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String },
});

const Product = mongoose.model('Product', productSchema);

// Order schema and model (move to separate model file)
const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  products: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      quantity: { type: Number },
    },
  ],
  totalAmount: { type: Number, required: true },
  status: { type: String, default: 'pending' },
});

const Order = mongoose.model('Order', orderSchema);

// Middleware to protect routes
const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Auth routes (register and login)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id }, `${process.env.JWT_SECRET}`, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login/otp'  , async (req, res) => {
  const { email} = req.body;
  try {
    const user = await User.findOne({ email });
    const existing_user_otp = await Otpdata.findOne({email})

    if (!user) {
      return res.status(401).json({ message: 'User not registered' });
    }
    
    const otp = Math.floor(100000 + Math.random() * 900000);
    
    const mailOptions = {
      from: `"Electrokart" ${process.env.email}`, 
      to: email, // list of receivers
      subject: 'Electrokart Login OTP', 
      text: `Your OTP to login to Electrokart is: ${otp}`, 
    };

    if (existing_user_otp) { 
      await Otpdata.deleteOne({ email });
    }
    let info = await transporter.sendMail(mailOptions);
     console.log('Email sent: ' + info.response);
    const newotp = await  Otpdata.create({otp:otp, email:email})
    res.status(201).json({ message: 'Otp successfully sended', newotp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }

}) ;

app.post('/api/auth/login/otp/verify', async (req, res) => {
  
  const { otp, email } = req.body;
  try {
    const user = await Otpdata.findOne({otp});
    const Userid = await User.findOne({email}); 
    if (!user ||  user.email !== email ) {
      return res.status(401).json({ message: 'Invalid OTP' });
    }

    const token = jwt.sign({ id: Userid._id }, `${process.env.JWT_SECRET}`, { expiresIn: '1h' });
    await Otpdata.deleteOne({ otp });
    res.status(201).json({ message: 'Otp successfully verified', token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

// Product routes
app.post('/api/products', authMiddleware, async (req, res) => {
  const { name, price, description, imageUrl } = req.body;
  try {
    const product = await Product.create({ name, price, description, imageUrl });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Order routes
app.post('/api/orders', authMiddleware, async (req, res) => {
  const { products, totalAmount } = req.body;
  try {
    const order = await Order.create({ user: req.user.id, products, totalAmount });
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).populate('products.product');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test route
app.get('/hello', async (req, res) => {
  console.log('Inside Hello GET Request');
  res.status(200).json({ message: 'Success' });
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
