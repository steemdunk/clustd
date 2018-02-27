const sourceMaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const gulp = require('gulp');
const path = require('path');
const del = require('del');

const config = path.join(__dirname, 'tsconfig.json');
const src = path.join(__dirname, 'src', '**', '*.ts');
const outDir = path.join(__dirname, 'out');

gulp.task('build', () => {
  const res = gulp.src(src)
                    .pipe(sourceMaps.init())
                    .pipe(ts.createProject('tsconfig.json')());

  return js = res.js.pipe(sourceMaps.write('.', {
    includeContent: false,
    sourceRoot: ""
  })).pipe(gulp.dest(outDir));
});

gulp.task('watch', ['build'], () => {
  return gulp.watch(src, ['build']);
});

gulp.task('clean', () => {
  return del(`${outDir}/**`);
});
