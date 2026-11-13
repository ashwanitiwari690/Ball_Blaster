import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WalletRepositoryPort } from '../app/core/ports/wallet-repository.port';
import { LocalWalletRepository } from '../app/core/adapters/local-wallet-repository';

export function configurePageTestBed(): void {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [
    provideHttpClient(), provideRouter([]),
    { provide: WalletRepositoryPort, useClass: LocalWalletRepository },
  ] });
}
