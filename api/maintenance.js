const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

let connectionPromise;

const maintenanceSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: 'maintenance'
        },
        enabled: {
            type: Boolean,
            default: false
        },
        message: {
            type: String,
            default: 'API sedang dalam maintenance.'
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: 'system'
    }
);

const Maintenance =
    mongoose.models.Maintenance ||
    mongoose.model('Maintenance', maintenanceSchema);

async function connectDB() {
    if (!MONGO_URI) {
        throw new Error('MONGO_URI belum dikonfigurasi.');
    }

    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!connectionPromise) {
        connectionPromise = mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 10000
        }).catch(error => {
            connectionPromise = null;
            throw error;
        });
    }

    await connectionPromise;
}

async function getMaintenanceMode() {
    await connectDB();

    const data = await Maintenance.findById('maintenance').lean();

    return {
        enabled: Boolean(data?.enabled),
        message: data?.message || 'API sedang dalam maintenance.',
        updatedAt: data?.updatedAt || null
    };
}

async function setMaintenanceMode(enabled, message) {
    await connectDB();

    const data = await Maintenance.findByIdAndUpdate(
        'maintenance',
        {
            $set: {
                enabled: Boolean(enabled),
                ...(message ? { message } : {}),
                updatedAt: new Date()
            }
        },
        {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
        }
    ).lean();

    return {
        enabled: Boolean(data.enabled),
        message: data.message,
        updatedAt: data.updatedAt
    };
}

async function handler(req, res) {
    try {
        const token =
            req.headers['x-maintenance-token'] ||
            req.body?.token ||
            req.query?.token;

        if (
            !process.env.MAINTENANCE_TOKEN ||
            token !== process.env.MAINTENANCE_TOKEN
        ) {
            return res.status(401).json({
                status: false,
                message: 'Unauthorized.'
            });
        }

        if (req.method === 'GET') {
            const data = await getMaintenanceMode();

            return res.status(200).json({
                status: true,
                maintenance: data.enabled,
                message: data.message,
                updatedAt: data.updatedAt
            });
        }

        if (req.method === 'POST') {
            const enabled =
                req.body?.enabled === true ||
                req.body?.enabled === 'true' ||
                req.query?.enabled === 'true';

            const data = await setMaintenanceMode(
                enabled,
                req.body?.message || req.query?.message
            );

            return res.status(200).json({
                status: true,
                maintenance: data.enabled,
                message: data.message,
                updatedAt: data.updatedAt
            });
        }

        return res.status(405).json({
            status: false,
            message: 'Method not allowed.'
        });
    } catch (error) {
        console.error('Maintenance Error:', error);

        return res.status(500).json({
            status: false,
            message: 'Gagal memproses maintenance.',
            error: error.message
        });
    }
}

module.exports = handler;
module.exports.getMaintenanceMode = getMaintenanceMode;
module.exports.setMaintenanceMode = setMaintenanceMode;