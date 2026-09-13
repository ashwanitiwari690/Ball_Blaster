import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameOverPage } from './game-over.page';

describe('GameOverPage', () => {
  let component: GameOverPage;
  let fixture: ComponentFixture<GameOverPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(GameOverPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
