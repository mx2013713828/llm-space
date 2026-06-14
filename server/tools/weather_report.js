export default {
  name: 'weather_report',
  description: 'Get the weather information of a specified city.',
  parameters: {
    city: { type: 'string', description: 'The name of the city (e.g. Beijing, Shanghai, New York).', required: true }
  },
  execute: async ({ city }) => {
    try {
      // 1. Get coordinates of the city (using Open-Meteo free geocoding API)
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`);
      const geoData = await geoRes.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        return `Could not find coordinates for city "${city}". Please check the spelling.`;
      }
      
      const { latitude, longitude, name, country } = geoData.results[0];

      // 2. Get weather details (using Open-Meteo free weather forecast API)
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
      const weatherData = await weatherRes.json();
      
      const current = weatherData.current;
      
      // Simple weather code converter
      const weatherCodeMap = {
        0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast', 
        45: 'Fog', 48: 'Depositing Rime Fog', 
        51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Dense Drizzle', 
        61: 'Slight Rain', 63: 'Moderate Rain', 65: 'Heavy Rain', 
        71: 'Slight Snow', 73: 'Moderate Snow', 75: 'Heavy Snow',
        95: 'Thunderstorm', 96: 'Thunderstorm with Slight Hail', 99: 'Thunderstorm with Heavy Hail'
      };
      
      const condition = weatherCodeMap[current.weather_code] || 'Unknown';

      return `[${name}, ${country}] Current Weather:
Temperature: ${current.temperature_2m}°C
Condition: ${condition}
Humidity: ${current.relative_humidity_2m}%
Wind Speed: ${current.wind_speed_10m} km/h`;

    } catch (error) {
      return `Failed to fetch weather: ${error.message}.\n💡 Tip: This tool requires access to the external Open-Meteo weather service. If you are in a restricted network environment, please configure a local proxy in the '.env' file in the root directory (e.g., append: HTTPS_PROXY=http://127.0.0.1:YOUR_PROXY_PORT) and restart the project.`;
    }
  }
};
