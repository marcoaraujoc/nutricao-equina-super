import { useAuth } from '../contexts/AuthContext';

export default function Auditoria() {
  const { auditLogs } = useAuth();

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8 flex items-center gap-3">
        📋 Auditoria de Acesso
      </h1>

      <div className="bg-gray-900 rounded-3xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-800">
            <tr>
              <th className="py-5 px-6 text-left">Usuário</th>
              <th className="py-5 px-6 text-left">E-mail</th>
              <th className="py-5 px-6 text-center">Ação</th>
              <th className="py-5 px-6 text-right">Data / Hora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {auditLogs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-800">
                <td className="py-5 px-6 font-medium">{log.userName}</td>
                <td className="py-5 px-6 text-gray-400">{log.email}</td>
                <td className="py-5 px-6 text-center">
                  <span
                    className={`inline-block px-4 py-1 rounded-full text-xs font-semibold ${
                      log.action === 'LOGIN'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {log.action === 'LOGIN' ? '🟢 Entrada' : '🔴 Saída'}
                  </span>
                </td>
                <td className="py-5 px-6 text-right text-gray-400 font-mono text-sm">
                  {log.timestamp}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {auditLogs.length === 0 && (
          <div className="py-16 text-center text-gray-500">
            Nenhum registro de acesso ainda.
          </div>
        )}
      </div>
    </div>
  );
}