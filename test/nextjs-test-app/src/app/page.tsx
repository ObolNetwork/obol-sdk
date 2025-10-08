'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<any>(null)

  // Catch any errors during render
  useEffect(() => {
    setMessage('Page mounted successfully ✅')
    
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error)
      setError({
        message: event.error?.message || 'Unknown error',
        stack: event.error?.stack || '',
        name: event.error?.name || 'Error'
      })
    }

    window.addEventListener('error', handleError)
    return () => window.removeEventListener('error', handleError)
  }, [])

  const testSDK = async () => {
    try {
      setError(null)
      setMessage('Loading SDK...')
      
      const { Client } = await import('@obolnetwork/obol-sdk')
      
      setMessage('Instantiating Client...')
      const client = new Client({
        baseUrl: 'https://api.obol.tech',
        chainId: 1
      })
      
      console.log('Client created:', client)
      setMessage(`✅ Success! SDK loaded and Client created. Chain: ${client.chainId}`)
    } catch (error: any) {
      const errorDetails = {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
      setError(errorDetails)
      setMessage(`❌ Error: ${error.message}`)
      console.error('Caught error:', errorDetails)
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '1200px' }}>
      <h1>Obol SDK Next.js Test</h1>
      
      <button 
        onClick={testSDK}
        style={{
          padding: '1rem 2rem',
          fontSize: '16px',
          background: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          marginTop: '1rem'
        }}
      >
        Test SDK Import
      </button>

      {message && (
        <div style={{ 
          marginTop: '2rem', 
          padding: '1rem', 
          background: message.includes('✅') ? '#d4edda' : '#f8d7da',
          borderRadius: '5px',
          border: `1px solid ${message.includes('✅') ? '#c3e6cb' : '#f5c6cb'}`
        }}>
          <strong>Status:</strong> {message}
        </div>
      )}

      {error && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '1rem', 
          background: '#fff3cd',
          borderRadius: '5px',
          border: '1px solid #ffeeba'
        }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#856404' }}>Error Details:</h3>
          <p><strong>Name:</strong> {error.name}</p>
          <p><strong>Message:</strong> {error.message}</p>
          <details>
            <summary style={{ cursor: 'pointer', color: '#856404', marginTop: '0.5rem' }}>
              Stack Trace (click to expand)
            </summary>
            <pre style={{ 
              fontSize: '12px', 
              overflow: 'auto', 
              background: '#fff', 
              padding: '0.5rem',
              borderRadius: '3px',
              marginTop: '0.5rem'
            }}>
              {error.stack}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
