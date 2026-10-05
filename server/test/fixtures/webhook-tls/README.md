These public, disposable PEM fixtures belong only to the loopback webhook receiver test.
The client never trusts this self-signed certificate; the test must reject it even after expiry.
The fixture private key is not an application credential and must never be used outside this test.
