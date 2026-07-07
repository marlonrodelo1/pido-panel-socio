package com.pidoo.socio;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local: detecta el cierre de la app -> offline instantáneo (Parte B).
        registerPlugin(OfflineBeaconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
