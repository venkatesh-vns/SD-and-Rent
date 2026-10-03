import axios from 'axios';

const api = axios.create({
  // Default: in development (npm start on port 3000) the API on port 5000 of
  // the same host; otherwise the server that served these screens (desktop app)
  baseURL: process.env.REACT_APP_API_URL || (window.location.port === '3000'
    ? `${window.location.protocol}//${window.location.hostname}:5000/api`
    : '/api'),
  // Multi-select filters are arrays: send them as one comma-separated value
  // (?sdType=Paid,Refund) and leave out empty filters.
  paramsSerializer: {
    serialize: (params) => {
      const q = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => {
        const value = Array.isArray(v) ? v.join(',') : v;
        if (value !== undefined && value !== null && value !== '') q.append(k, value);
      });
      return q.toString();
    },
  },
});

// Attach JWT token to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the token is rejected/expired, force the user back to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?expired=1';
      }
    }
    return Promise.reject(error);
  }
);

// Server error message, or the fallback when there is none
export function errorMessage(err, fallback) {
  return err.response?.data?.message || fallback;
}

// Downloads a file (Excel template/export/report) through the authenticated client
export async function downloadFile(url, params = {}, fallbackName = 'download.xlsx') {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(res.data);
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export default api;
