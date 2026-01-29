import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';

const router = Router();

// Todas las rutas requieren autenticación y suscripción
router.use(authenticate);
router.use(requireSubscriptionOrDev);

/**
 * GET /dashboard/summary
 * Obtener resumen financiero del usuario
 */
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const { month, year } = req.query;

    // Determinar período (por defecto: mes actual)
    const now = new Date();
    const targetYear = year ? parseInt(year) : now.getFullYear();
    const targetMonth = month ? parseInt(month) - 1 : now.getMonth();

    const startOfMonth = new Date(targetYear, targetMonth, 1);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0);

    const startDate = startOfMonth.toISOString().split('T')[0];
    const endDate = endOfMonth.toISOString().split('T')[0];

    // Obtener transacciones del período
    const { data: transactions, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (error) {
      console.error('Dashboard summary error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al obtener resumen');
    }

    // Calcular totales
    const incomes = transactions.filter((t) => t.type === 'income');
    const expenses = transactions.filter((t) => t.type === 'expense');

    const totalIncome = incomes.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalExpenses = expenses.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const balance = totalIncome - totalExpenses;

    // Calcular por categoría
    const expensesByCategory = {};
    expenses.forEach((t) => {
      const cat = t.category || 'Sin categoría';
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + parseFloat(t.amount);
    });

    const incomesByCategory = {};
    incomes.forEach((t) => {
      const cat = t.category || 'Sin categoría';
      incomesByCategory[cat] = (incomesByCategory[cat] || 0) + parseFloat(t.amount);
    });

    // Obtener transacciones recientes (últimas 5)
    const recentTransactions = transactions.slice(0, 5).map((t) => ({
      id: t.id,
      type: t.type,
      amount: parseFloat(t.amount),
      category: t.category,
      description: t.description,
      date: t.date,
    }));

    // Calcular datos por día para gráficos
    const dailyData = {};
    transactions.forEach((t) => {
      if (!dailyData[t.date]) {
        dailyData[t.date] = { date: t.date, income: 0, expense: 0 };
      }
      if (t.type === 'income') {
        dailyData[t.date].income += parseFloat(t.amount);
      } else {
        dailyData[t.date].expense += parseFloat(t.amount);
      }
    });

    return success(res, {
      period: {
        month: targetMonth + 1,
        year: targetYear,
        startDate,
        endDate,
      },
      balance: Math.round(balance * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      transactionsCount: transactions.length,
      savingsRate: totalIncome > 0 
        ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 1000) / 10 
        : 0,
      expensesByCategory: Object.entries(expensesByCategory).map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      })),
      incomesByCategory: Object.entries(incomesByCategory).map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      })),
      dailyData: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
      recentTransactions,
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * GET /dashboard/stats
 * Estadísticas generales (todos los tiempos)
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    // Totales generales
    const { data: allTransactions } = await supabaseAdmin
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId);

    const totalIncome = allTransactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const totalExpenses = allTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Últimos 6 meses para gráfico
    const monthlyData = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startDate = date.toISOString().split('T')[0];
      const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0)
        .toISOString()
        .split('T')[0];

      const { data: monthTransactions } = await supabaseAdmin
        .from('transactions')
        .select('type, amount')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate);

      const monthIncome = (monthTransactions || [])
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const monthExpense = (monthTransactions || [])
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      monthlyData.push({
        month: date.toLocaleString('es', { month: 'short' }),
        year: date.getFullYear(),
        income: Math.round(monthIncome * 100) / 100,
        expense: Math.round(monthExpense * 100) / 100,
      });
    }

    return success(res, {
      totalBalance: Math.round((totalIncome - totalExpenses) * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalTransactions: allTransactions.length,
      monthlyData,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
