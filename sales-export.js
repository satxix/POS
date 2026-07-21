// Sales CSV export extracted from app.js in v8.2.0.
// Depends on app globals: getPeriodTransactions, csvEscape, showToast.

function exportSalesCSV() {
    const trans = getPeriodTransactions(); if (trans.length === 0) return;
    const csvContent = ["Date,ID,Type,Customer,Subtotal,Discount,Total,Notes", ...trans.map(t => [
        new Date(t.timestamp).toLocaleDateString(),
        t.id,
        t.type,
        t.customer || 'N/A',
        t.subtotal || t.total || 0,
        t.discount || 0,
        t.total,
        t.notes || ''
    ].map(csvEscape).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Villacart_Sales.csv`; link.click(); showToast("Exported", "success");
}
