import { useState } from 'react';
import api from '../services/api';

const QueryAdHoc = () => {
  const [query, setQuery] = useState('SELECT \'TESTE\' AS mensagem;');
  const [result, setResult] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const executeQuery = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Caminho correto conforme seu server.js
      const res = await api.post('/adhoc', { query });

      const data = res.data;

      let resultData = [];

      if (data.success && Array.isArray(data.data)) {
        resultData = data.data;
      } else if (Array.isArray(data)) {
        resultData = data;
      }

      setResult(resultData);
      
      if (resultData.length > 0) {
        setColumns(Object.keys(resultData[0]));
      } else {
        setColumns([]);
      }
    } catch (err: any) {
      console.error('Erro completo:', err.response || err);
      setError(err.response?.data?.error || err.message || 'Erro ao executar query');
      setResult([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white min-h-screen text-gray-900">
      <h1 className="text-2xl font-bold mb-4">Query Ad-Hoc (MySQL)</h1>
      
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-40 p-4 border rounded-lg font-mono text-sm text-gray-900 bg-white"
        placeholder="Digite sua query SQL aqui..."
      />

      <button
        onClick={executeQuery}
        disabled={loading}
        className="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Executando...' : 'Executar Query'}
      </button>

      {error && <p className="text-red-600 mt-4 font-medium">{error}</p>}

      {result.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-2 text-gray-900">
            Resultado ({result.length} registros)
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  {columns.map((col) => (
                    <th key={col} className="border border-gray-300 px-4 py-2 text-left text-sm font-medium text-gray-700">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-gray-50">
                    {columns.map((col) => (
                      <td key={col} className="border border-gray-300 px-4 py-2 text-sm text-gray-900">
                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.length === 0 && !error && !loading && query && (
        <p className="mt-6 text-gray-500">Nenhum resultado encontrado.</p>
      )}
    </div>
  );
};

export default QueryAdHoc;