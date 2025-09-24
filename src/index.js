#!/usr/bin/env node

/**
 * Keephy Categories Service
 * Manages feedback categories and subcategories
 */

import express from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const PORT = process.env.PORT || 3018;

// Middleware
app.use(helmet());
app.use(cors());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/keephy_enhanced';

mongoose.connect(MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

// Category Schema
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  icon: String,
  color: String,
  isActive: { type: Boolean, default: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  tenantId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Category = mongoose.model('Category', categorySchema);

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'keephy_categories',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ready', service: 'keephy_categories' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// Get all categories
app.get('/api/categories', async (req, res) => {
  try {
    const { businessId, tenantId, parentId } = req.query;
    
    let filter = { isActive: true };
    if (businessId) filter.businessId = businessId;
    if (tenantId) filter.tenantId = tenantId;
    if (parentId) filter.parentId = parentId;
    
    const categories = await Category.find(filter)
      .populate('subcategories')
      .sort({ name: 1 });
    
    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

// Get category by ID
app.get('/api/categories/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('subcategories');
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error fetching category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category'
    });
  }
});

// Get subcategories
app.get('/api/categories/:id/subcategories', async (req, res) => {
  try {
    const subcategories = await Category.find({ 
      parentId: req.params.id,
      isActive: true 
    }).sort({ name: 1 });
    
    res.json({
      success: true,
      data: subcategories,
      count: subcategories.length
    });
  } catch (error) {
    logger.error('Error fetching subcategories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subcategories'
    });
  }
});

// Create category
app.post('/api/categories', async (req, res) => {
  try {
    const { name, description, icon, color, parentId, businessId, tenantId } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required'
      });
    }
    
    const category = new Category({
      name,
      description,
      icon,
      color,
      parentId: parentId || null,
      businessId,
      tenantId
    });
    
    await category.save();
    
    // If this is a subcategory, update parent
    if (parentId) {
      await Category.findByIdAndUpdate(parentId, {
        $addToSet: { subcategories: category._id }
      });
    }
    
    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category'
    });
  }
});

// Update category
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { name, description, icon, color, isActive } = req.body;
    
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      {
        name,
        description,
        icon,
        color,
        isActive,
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update category'
    });
  }
});

// Delete category
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    // Soft delete
    category.isActive = false;
    await category.save();
    
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Keephy Categories Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});
