import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';

const router = Router();

router.use(authenticate);
router.use(requireSubscriptionOrDev);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const BUCKET = 'transaction-documents';

// POST /api/transactions/:transactionId/documents
router.post('/:transactionId/documents', upload.single('file'), async (req, res) => {
  const userId = req.user.id;
  const { transactionId } = req.params;

  if (!req.file) {
    return sendError(res, 'NO_FILE', 'No se recibió ningún archivo o el tipo no está permitido', 400);
  }

  // Verify transaction belongs to user
  const { data: tx, error: txErr } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single();

  if (txErr || !tx) {
    return sendError(res, 'NOT_FOUND', 'Transacción no encontrada', 404);
  }

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const filePath = `${userId}/${transactionId}/${Date.now()}-${safeName}`;

  const { error: storageErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });

  if (storageErr) {
    console.error('Storage upload error:', storageErr);
    return sendError(res, 'STORAGE_ERROR', 'Error al subir el archivo', 500);
  }

  const { data: doc, error: dbErr } = await supabaseAdmin
    .from('transaction_documents')
    .insert({
      transaction_id: transactionId,
      user_id: userId,
      file_name: req.file.originalname,
      file_path: filePath,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
    })
    .select()
    .single();

  if (dbErr) {
    // Cleanup storage on DB failure
    await supabaseAdmin.storage.from(BUCKET).remove([filePath]);
    return sendError(res, 'DB_ERROR', 'Error al guardar el documento', 500);
  }

  // Generate signed URL for immediate use
  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(filePath, 3600);

  return success(res, { document: { ...doc, signed_url: signed?.signedUrl || null } }, 201);
});

// GET /api/transactions/:transactionId/documents
router.get('/:transactionId/documents', async (req, res) => {
  const userId = req.user.id;
  const { transactionId } = req.params;

  const { data: tx, error: txErr } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single();

  if (txErr || !tx) {
    return sendError(res, 'NOT_FOUND', 'Transacción no encontrada', 404);
  }

  const { data: docs, error: dbErr } = await supabaseAdmin
    .from('transaction_documents')
    .select('*')
    .eq('transaction_id', transactionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (dbErr) {
    return sendError(res, 'DB_ERROR', 'Error al obtener los documentos', 500);
  }

  // Add signed URLs
  const withUrls = await Promise.all(
    (docs || []).map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(doc.file_path, 3600);
      return { ...doc, signed_url: signed?.signedUrl || null };
    })
  );

  return success(res, { documents: withUrls });
});

// DELETE /api/documents/doc/:docId
router.delete('/doc/:docId', async (req, res) => {
  const userId = req.user.id;
  const { docId } = req.params;

  const { data: doc, error: findErr } = await supabaseAdmin
    .from('transaction_documents')
    .select('*')
    .eq('id', docId)
    .eq('user_id', userId)
    .single();

  if (findErr || !doc) {
    return sendError(res, 'NOT_FOUND', 'Documento no encontrado', 404);
  }

  await supabaseAdmin.storage.from(BUCKET).remove([doc.file_path]);

  await supabaseAdmin
    .from('transaction_documents')
    .delete()
    .eq('id', docId)
    .eq('user_id', userId);

  return success(res, { deleted: true });
});

export default router;
