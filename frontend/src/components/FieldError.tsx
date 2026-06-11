interface FieldErrorProps {
  message?: string;
}

export default function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return <p className="text-[11px] text-red-500 mt-1">{message}</p>;
}

export function inputErrCls(hasError?: boolean): string {
  return [
    'w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2',
    hasError
      ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
      : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-100',
  ].join(' ');
}
